import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DisplayMode,
  LibrarySnapshot,
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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('logicalSongs');
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playOnNextLoadRef = useRef(false);
  const repeatModeRef = useRef<RepeatMode>('off');
  const moveInQueueRef = useRef<(
    direction: 1 | -1,
    options: { wrap: boolean; autoplay: boolean }
  ) => boolean>(() => false);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTimeSeconds(audio.currentTime || 0);
    };

    const onLoadedMetadata = () => {
      setDurationSeconds(Number.isFinite(audio.duration) ? audio.duration : 0);
    };

    const onCanPlay = () => {
      if (!playOnNextLoadRef.current) {
        return;
      }

      playOnNextLoadRef.current = false;
      void audio.play().catch((cause: unknown) => {
        setPlaybackError(cause instanceof Error ? cause.message : String(cause));
      });
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    const onEnded = () => {
      const mode = repeatModeRef.current;

      if (mode === 'one') {
        audio.currentTime = 0;
        void audio.play().catch((cause: unknown) => {
          setPlaybackError(cause instanceof Error ? cause.message : String(cause));
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
      const mediaError = audio.error;
      const code = mediaError?.code ? ` (code ${mediaError.code})` : '';
      setPlaybackError(`Playback failed. File format may be unsupported${code}.`);
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();

      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
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

  const versions = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const filtered = query.length
      ? snapshot.versions.filter((version) =>
          version.fileName.toLowerCase().includes(query)
        )
      : snapshot.versions;

    return sortVersions(filtered);
  }, [searchText, snapshot.versions]);

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

    setPlaybackError(null);
    setCurrentTimeSeconds(0);
    setDurationSeconds(0);

    if (!selectedPlaybackVersion) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }

    window.producerPlayer
      .toFileUrl(selectedPlaybackVersion.filePath)
      .then((fileUrl) => {
        if (cancelled) {
          return;
        }

        audio.pause();
        audio.src = '';
        audio.src = fileUrl;
        audio.load();
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }

        setPlaybackError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlaybackVersion]);

  const playbackQueue = useMemo(() => {
    if (displayMode === 'versions') {
      return versions;
    }

    const queue: SongVersion[] = [];

    for (const song of songs) {
      const activeVersion = getActiveSongVersion(song);
      if (activeVersion) {
        queue.push(activeVersion);
      }
    }

    return queue;
  }, [displayMode, songs, versions]);

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

  const canReorderSongs =
    displayMode === 'logicalSongs' && searchText.trim().length === 0;

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

    if (!selectedPlaybackVersion && playbackQueue.length > 0) {
      const firstVersion = playbackQueue[0];
      playOnNextLoadRef.current = true;
      setSelectedSongId(firstVersion.songId);
      setSelectedPlaybackVersionId(firstVersion.id);
      return;
    }

    if (!selectedPlaybackVersion) {
      return;
    }

    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (cause: unknown) {
      setPlaybackError(cause instanceof Error ? cause.message : String(cause));
    }
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
          title="Use end-of-name version tags for grouping: v1, v2, v3."
        >
          <div className="naming-guide-header">
            <h3>Naming</h3>
            <span
              className="help-pill"
              title="Version tags should be at the end of the file name."
              aria-label="Naming help"
            >
              i
            </span>
          </div>
          <p>
            Use end-of-name version tags: <code>v1</code>, <code>v2</code>, <code>v3</code>{' '}
            (for example <code>Leaky v2.wav</code> or <code>Leakyv2.wav</code>).
          </p>
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
              onClick={() => setDisplayMode('logicalSongs')}
              className={`mode-toggle ${displayMode === 'logicalSongs' ? 'active' : ''}`}
              data-testid="mode-tracks"
              title="Show one row per track, grouped by version suffix."
            >
              Tracks
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('versions')}
              className={`mode-toggle ${displayMode === 'versions' ? 'active' : ''}`}
              data-testid="mode-versions"
              title="Show every individual version file."
            >
              Versions
            </button>
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
              title="Move older non-archived versions into old/ and keep newest version in place."
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
            title="Search by track title, normalized title, or file name."
          />
        </div>

        {displayMode === 'logicalSongs' ? (
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
        ) : (
          <ul className="main-list" data-testid="main-list">
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSongId(version.songId);
                    setSelectedPlaybackVersionId(version.id);
                  }}
                  data-testid="main-list-row"
                  title="Select this version in the inspector and player."
                >
                  <div>
                    <strong>{version.fileName}</strong>
                    <p className="muted">{version.filePath}</p>
                  </div>
                  <span className="muted">{formatDate(version.modifiedAt)}</span>
                </button>
              </li>
            ))}
            {versions.length === 0 && (
              <li className="empty-state">No versions match your search.</li>
            )}
          </ul>
        )}

        {selectedPlaybackVersion && (
          <section className="player-dock" data-testid="player-dock">
            <div className="player-dock-top">
              <div>
                <strong data-testid="player-track-name">{selectedPlaybackVersion.fileName}</strong>
                <p className="muted">
                  {selectedSong?.title ?? 'Unknown Track'}
                  {isArchivedVersion(selectedPlaybackVersion) ? ' · Archived in old/' : ''}
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
                onClick={() => {
                  void handleTogglePlayback();
                }}
                title="Play or pause the selected track."
              >
                {isPlaying ? 'Pause' : 'Play'}
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
            <p className="muted">Normalized: {selectedSong.normalizedTitle}</p>
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

        <section className="inspector-card status-card" data-testid="status-card">
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
      </aside>
    </div>
  );
}
