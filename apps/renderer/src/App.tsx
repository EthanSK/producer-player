import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LibrarySnapshot,
  PlaybackSourceInfo,
  SongVersion,
  SongWithVersions,
} from '@producer-player/contracts';

type RepeatMode = 'off' | 'one' | 'all';

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

const REPEAT_MODE_LABEL: Record<RepeatMode, string> = {
  off: 'Off',
  one: 'One',
  all: 'All',
};

const PLAYBACK_LOAD_TIMEOUT_MS = 4500;

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
  const extension = source?.extension ? `.${source.extension}` : 'this file format';

  return `If ${extension} cannot be decoded by this Chromium runtime, convert to WAV/MP3/AAC-M4A (for example: ffmpeg -i input${extension === 'this file format' ? '' : extension} -c:a pcm_s16le output.wav).`;
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

function isArchivedVersion(version: SongVersion): boolean {
  return /[\\/]old[\\/]/i.test(version.filePath);
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

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(EMPTY_SNAPSHOT);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [searchText, setSearchText] = useState('');
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedPlaybackVersionId, setSelectedPlaybackVersionId] = useState<string | null>(
    null
  );
  const [dragSongId, setDragSongId] = useState<string | null>(null);
  const [folderPathInput, setFolderPathInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackSource, setPlaybackSource] = useState<PlaybackSourceInfo | null>(null);
  const [playbackSourceSupport, setPlaybackSourceSupport] = useState<'unknown' | 'maybe' | 'probably' | 'no'>(
    'unknown'
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playbackSourceReady, setPlaybackSourceReady] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playOnNextLoadRef = useRef(false);
  const repeatModeRef = useRef<RepeatMode>('off');
  const playbackSourceRef = useRef<PlaybackSourceInfo | null>(null);
  const expectedSourceUrlRef = useRef<string | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRequestIdRef = useRef(0);
  const playbackSourceSupportRef = useRef<'unknown' | 'maybe' | 'probably' | 'no'>('unknown');
  const playbackSourceReadyRef = useRef(false);
  const moveInQueueRef = useRef<(
    direction: 1 | -1,
    options: { wrap: boolean; autoplay: boolean }
  ) => boolean>(() => false);

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
      selectedSourceUrl: playbackSourceRef.current?.url ?? null,
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

      const extensionText = source?.extension ? `.${source.extension}` : 'unknown format';
      const supportText =
        playbackSourceSupportRef.current === 'no'
          ? `${extensionText} is not reported as playable by this Chromium runtime.`
          : `The source never reached canplay within ${PLAYBACK_LOAD_TIMEOUT_MS}ms.`;

      const message = `Playback could not start (${context}). ${supportText} ${buildPlaybackFallbackGuidance(
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
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTimeSeconds(audio.currentTime || 0);
    };

    const onLoadedMetadata = () => {
      setDurationSeconds(Number.isFinite(audio.duration) ? audio.duration : 0);
      logPlaybackEvent('loadedmetadata', {
        durationSeconds: Number.isFinite(audio.duration) ? audio.duration : null,
      });
    };

    const onLoadStart = () => {
      setPlaybackSourceReady(false);
      logPlaybackEvent('loadstart');
    };

    const onCanPlay = () => {
      setPlaybackSourceReady(true);
      clearPlaybackLoadTimeout();
      logPlaybackEvent('canplay');

      if (!playOnNextLoadRef.current) {
        return;
      }

      playOnNextLoadRef.current = false;

      void audio.play().catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setPlaybackError(
          `Playback start failed after canplay: ${message}. ${buildPlaybackFallbackGuidance(
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
      logPlaybackEvent('pause');
    };

    const onEnded = () => {
      const mode = repeatModeRef.current;
      logPlaybackEvent('ended', {
        repeatMode: mode,
      });

      if (mode === 'one') {
        audio.currentTime = 0;
        void audio.play().catch((cause: unknown) => {
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
          ? `${source?.extension ? `.${source.extension}` : 'This format'} appears unsupported or blocked in this Chromium runtime.`
          : 'Chromium could not decode or load the selected source.';

      const message = `Playback failed: ${detail}. ${compatibilityHint} ${buildPlaybackFallbackGuidance(
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
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    window.producerPlayer
      .getLibrarySnapshot()
      .then((initial) => {
        if (!mounted) {
          return;
        }

        setSnapshot(initial);
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

  const songs = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (query.length === 0) {
      return snapshot.songs;
    }

    return snapshot.songs.filter((song) => {
      return (
        song.title.toLowerCase().includes(query) ||
        song.normalizedTitle.toLowerCase().includes(query) ||
        song.versions.some((version) => version.fileName.toLowerCase().includes(query))
      );
    });
  }, [searchText, snapshot.songs]);

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

    const nextPlaybackVersionId =
      selectedSong.activeVersionId ?? sortVersions(selectedSong.versions)[0]?.id ?? null;

    setSelectedPlaybackVersionId(nextPlaybackVersionId);
  }, [selectedPlaybackVersionId, selectedSong]);

  const selectedPlaybackVersion =
    snapshot.versions.find((version) => version.id === selectedPlaybackVersionId) ?? null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    let cancelled = false;
    const requestId = sourceRequestIdRef.current + 1;
    sourceRequestIdRef.current = requestId;

    clearPlaybackLoadTimeout();
    setPlaybackError(null);
    setCurrentTimeSeconds(0);
    setDurationSeconds(0);
    setPlaybackSourceReady(false);
    setPlaybackSourceSupport('unknown');

    if (!selectedPlaybackVersion) {
      playOnNextLoadRef.current = false;
      setPlaybackSource(null);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      logPlaybackEvent('source-cleared', {
        reason: 'no-selected-version',
      });
      return;
    }

    window.producerPlayer
      .resolvePlaybackSource(selectedPlaybackVersion.filePath)
      .then((source) => {
        if (cancelled || requestId !== sourceRequestIdRef.current) {
          return;
        }

        setPlaybackSource(source);

        if (!source.exists) {
          const message = `Selected file is missing on disk: ${source.filePath}. Rescan or relink the folder.`;
          setPlaybackError(message);
          logPlaybackEvent('source-missing', {
            message,
          });
          return;
        }

        audio.pause();
        audio.removeAttribute('src');
        audio.src = source.url;

        const supportHintRaw = source.mimeType
          ? audio.canPlayType(source.mimeType)
          : '';

        const supportHint =
          supportHintRaw === 'probably' || supportHintRaw === 'maybe'
            ? supportHintRaw
            : 'no';

        setPlaybackSourceSupport(supportHint);

        logPlaybackEvent('source-selected', {
          requestId,
          filePath: source.filePath,
          url: source.url,
          mimeType: source.mimeType,
          supportHint,
        });

        audio.load();
      })
      .catch((cause: unknown) => {
        if (cancelled || requestId !== sourceRequestIdRef.current) {
          return;
        }

        const message = cause instanceof Error ? cause.message : String(cause);
        setPlaybackError(message);
        setPlaybackSource(null);
        logPlaybackEvent('source-resolve-failed', {
          requestId,
          message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlaybackVersion]);

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

  const currentQueueIndex = useMemo(() => {
    if (!selectedPlaybackVersion) {
      return -1;
    }

    return playbackQueue.findIndex((version) => version.id === selectedPlaybackVersion.id);
  }, [playbackQueue, selectedPlaybackVersion]);

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
      setSelectedSongId(nextVersion.songId);
      setSelectedPlaybackVersionId(nextVersion.id);
      return true;
    };
  }, [currentQueueIndex, playbackQueue]);

  const canReorderSongs = searchText.trim().length === 0;

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

  async function handleSetAutoMoveOld(enabled: boolean): Promise<void> {
    await runSnapshotTask(() => window.producerPlayer.setAutoMoveOld(enabled));
  }

  async function handleReorderSongs(droppedOnSongId: string): Promise<void> {
    if (!dragSongId || dragSongId === droppedOnSongId) {
      return;
    }

    const currentOrder = snapshot.songs.map((song) => song.id);
    const fromIndex = currentOrder.indexOf(dragSongId);
    const toIndex = currentOrder.indexOf(droppedOnSongId);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const nextOrder = [...currentOrder];
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, dragSongId);

    await runSnapshotTask(() => window.producerPlayer.reorderSongs(nextOrder));
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
      setPlaybackError(`Selected file is missing on disk: ${source.filePath}. Rescan or relink the folder.`);
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
            `This source is not reported as playable by this Chromium runtime (${source?.mimeType ?? 'unknown MIME'}). ${buildPlaybackFallbackGuidance(
              source
            )}`
          );
        }

        return;
      }

      try {
        await audio.play();
        logPlaybackEvent('play-requested-direct');
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setPlaybackError(`Playback start failed: ${message}. ${buildPlaybackFallbackGuidance(source)}`);
        logPlaybackEvent('play-rejected', {
          message,
        });
      }
      return;
    }

    playOnNextLoadRef.current = false;
    clearPlaybackLoadTimeout();
    audio.pause();
  }

  function handleSeek(nextTimeSeconds: number): void {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTimeSeconds)) {
      return;
    }

    audio.currentTime = nextTimeSeconds;
    setCurrentTimeSeconds(nextTimeSeconds);
  }

  function handlePreviousTrack(): void {
    void moveInQueueRef.current(-1, {
      wrap: repeatMode === 'all',
      autoplay: isPlaying,
    });
  }

  function handleNextTrack(): void {
    void moveInQueueRef.current(1, {
      wrap: repeatMode === 'all',
      autoplay: isPlaying,
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

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="panel panel-left">
        <header className="panel-header">
          <h2>Watch Folders</h2>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void handleOpenFolderDialog();
              }}
              data-testid="link-folder-dialog-button"
              title="Choose a folder to watch for exported audio files."
            >
              Add Folder…
            </button>
          </div>
        </header>

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

        <section
          className="naming-guide"
          data-testid="naming-guide"
          title="File names must end with v1, v2, v3. Example: Leaky v2.wav or Leakyv2.wav."
        >
          <p>File names must end with v1, v2, v3 — for example Leaky v2.wav or Leakyv2.wav.</p>
        </section>

        <section className="sidebar-status" data-testid="status-card">
          <h3>Status</h3>
          <p>
            <strong>{snapshot.status}</strong> — {snapshot.statusMessage}
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
            <li className="empty-state">No watch folders linked yet.</li>
          )}
        </ul>
      </aside>

      <main className="panel panel-main">
        <header className="panel-header">
          <div className="panel-title">
            <h2>Group / Album</h2>
            <p className="muted">{snapshot.songs.length} track(s)</p>
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
          </div>
        </header>

        <div className="filter-row">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search tracks or versions"
            data-testid="search-input"
            title="Search by raw file name, grouped title, or version file name."
          />
        </div>

        <p
          className="list-hint"
          data-testid="track-order-hint"
          title="Drag and drop tracks to reorder them. Producer Player keeps this order between sessions."
        >
          Drag tracks to reorder — track positions are preserved.
        </p>

        <ul className="main-list" data-testid="main-list">
          {songs.map((song) => (
            <li key={song.id}>
              <button
                type="button"
                className={`${song.id === selectedSongId ? 'selected' : ''} ${
                  dragSongId === song.id ? 'drag-source' : ''
                }`}
                onClick={() => setSelectedSongId(song.id)}
                data-testid="main-list-row"
                data-song-id={song.id}
                draggable={canReorderSongs}
                onDragStart={(event) => {
                  if (!canReorderSongs) {
                    return;
                  }

                  setDragSongId(song.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', song.id);
                }}
                onDragOver={(event) => {
                  if (!canReorderSongs) {
                    return;
                  }
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleReorderSongs(song.id);
                  setDragSongId(null);
                }}
                onDragEnd={() => {
                  setDragSongId(null);
                }}
                title={
                  canReorderSongs
                    ? 'Select track. Drag rows to reorder track order.'
                    : 'Select track. Clear search to enable drag-and-drop ordering.'
                }
              >
                <div>
                  <strong>{song.title}</strong>
                  <p className="muted">{song.versions.length} version(s)</p>
                </div>
                <span className="muted">{formatDate(song.latestExportAt)}</span>
              </button>
            </li>
          ))}
          {songs.length === 0 && (
            <li className="empty-state">No tracks found in linked folders.</li>
          )}
        </ul>

        {selectedPlaybackVersion && (
          <section className="player-dock" data-testid="player-dock">
            <div className="player-dock-top">
              <div>
                <strong data-testid="player-track-name">{selectedPlaybackVersion.fileName}</strong>
                <p className="muted">
                  {selectedSong?.title ?? 'Unknown track'}
                  {isArchivedVersion(selectedPlaybackVersion) ? ' · Archived in old/' : ''}
                </p>
                <p className="muted" data-testid="playback-source-meta">
                  Source: {playbackSource?.mimeType ?? 'unknown MIME'} · canPlayType: {playbackSourceSupport}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void window.producerPlayer.revealFile(selectedPlaybackVersion.filePath);
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
                title="Jump to previous track in the current queue."
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

        {selectedSong ? (
          <section className="inspector-card">
            <h3 data-testid="inspector-song-title">{selectedSong.title}</h3>
            <p className="muted">Normalized title: {selectedSong.normalizedTitle}</p>
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
                  {isArchivedVersion(version) ? (
                    <p className="muted archived-label">Archived in old/</p>
                  ) : null}
                </div>
                <div className="version-actions">
                  <button
                    type="button"
                    onClick={() => setSelectedPlaybackVersionId(version.id)}
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

      </aside>
    </div>
  );
}
