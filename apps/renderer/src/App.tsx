import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DisplayMode,
  LibrarySnapshot,
  SongVersion,
  SongWithVersions,
} from '@producer-player/contracts';

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

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(EMPTY_SNAPSHOT);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('logicalSongs');
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

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    const onError = () => {
      setPlaybackError('Could not play this audio file in the current environment.');
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
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

    const availableVersionIds = new Set(inspectorVersions.map((version) => version.id));

    if (
      selectedPlaybackVersionId &&
      availableVersionIds.has(selectedPlaybackVersionId)
    ) {
      return;
    }

    const nextPlaybackVersionId =
      selectedSong.activeVersionId ?? inspectorVersions[0]?.id ?? null;

    setSelectedPlaybackVersionId(nextPlaybackVersionId);
  }, [
    inspectorVersions,
    selectedPlaybackVersionId,
    selectedSong,
    selectedSong?.activeVersionId,
  ]);

  const selectedPlaybackVersion =
    inspectorVersions.find((version) => version.id === selectedPlaybackVersionId) ?? null;

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

  const selectedFolder = useMemo(() => {
    if (!selectedFolderId) {
      return null;
    }

    return snapshot.linkedFolders.find((folder) => folder.id === selectedFolderId) ?? null;
  }, [selectedFolderId, snapshot.linkedFolders]);

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

  async function handleUnlinkFolder(folderId: string): Promise<void> {
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

  async function handleOpenSelectedFolder(): Promise<void> {
    if (!selectedFolder) {
      return;
    }

    await runVoidTask(() => window.producerPlayer.openFolder(selectedFolder.path));
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
    if (!audio || !selectedPlaybackVersion) {
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

  function handleStopPlayback(): void {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    setCurrentTimeSeconds(0);
  }

  function handleSeek(nextTimeSeconds: number): void {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTimeSeconds)) {
      return;
    }

    audio.currentTime = nextTimeSeconds;
    setCurrentTimeSeconds(nextTimeSeconds);
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
            <button
              type="button"
              disabled={!selectedFolder}
              onClick={() => {
                void handleOpenSelectedFolder();
              }}
              title="Open the currently selected watched folder in Finder."
            >
              Open Folder
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
                <button
                  type="button"
                  className="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    void runVoidTask(() => window.producerPlayer.openFolder(folder.path));
                  }}
                  title="Open this watched folder in Finder."
                >
                  Open
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleUnlinkFolder(folder.id);
                  }}
                  title="Stop watching this folder and remove it from the library."
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

        <section className="song-shortcuts">
          <h3>Actual Songs</h3>
          <ul>
            {songs.slice(0, 15).map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  className={song.id === selectedSongId ? 'selected' : ''}
                  onClick={() => setSelectedSongId(song.id)}
                  title="Select this song and inspect its versions."
                >
                  {song.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="panel panel-main">
        <header className="panel-header">
          <h2>Library</h2>
          <div className="actions">
            <button
              type="button"
              onClick={() => setDisplayMode('logicalSongs')}
              className={`mode-toggle ${displayMode === 'logicalSongs' ? 'active' : ''}`}
              data-testid="mode-actual-songs"
              title="Show one row per actual song, grouped by version suffix matching."
            >
              Actual Songs
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('versions')}
              className={`mode-toggle ${displayMode === 'versions' ? 'active' : ''}`}
              data-testid="mode-versions"
              title="Show every individual export version as its own row."
            >
              Versions
            </button>
            <button
              type="button"
              className="action-button"
              onClick={() => {
                void handleRescan();
              }}
              title="Rescan all watched folders right now for added, changed, or removed files."
            >
              Rescan
            </button>
            <button
              type="button"
              className="action-button secondary"
              onClick={() => {
                void handleOrganize();
              }}
              title="Move older versions into each folder's old/ directory, keeping the newest version in place."
            >
              Organize
            </button>
          </div>
        </header>

        <div className="filter-row">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search songs or versions"
            data-testid="search-input"
            title="Search by song title, normalized title, or file name."
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
                      ? 'Select song. Drag rows to reorder actual song playback/list order.'
                      : 'Select song. Clear search to enable drag-and-drop reordering.'
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
              <li className="empty-state">No songs found in linked folders.</li>
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
                  title="Select this specific version in the inspector and player."
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
      </main>

      <aside className="panel panel-right">
        <header className="panel-header">
          <h2>Inspector</h2>
        </header>

        {selectedSong ? (
          <section className="inspector-card">
            <h3 data-testid="inspector-song-title">{selectedSong.title}</h3>
            <p className="muted">Normalized: {selectedSong.normalizedTitle}</p>
            <p className="muted">
              Latest export: {formatDate(selectedSong.latestExportAt)}
            </p>
          </section>
        ) : (
          <section className="inspector-card empty-state">
            Select a song to inspect versions.
          </section>
        )}

        <section className="inspector-card player-card">
          <h3>Player</h3>
          <p className="muted">
            {selectedPlaybackVersion
              ? `Selected: ${selectedPlaybackVersion.fileName}`
              : 'Select a version to play.'}
          </p>

          <div className="transport-row">
            <button
              type="button"
              disabled={!selectedPlaybackVersion}
              onClick={() => {
                void handleTogglePlayback();
              }}
              title="Play or pause the selected version."
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              disabled={!selectedPlaybackVersion}
              onClick={handleStopPlayback}
              title="Stop playback and return to the start of the selected version."
            >
              Stop
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={durationSeconds > 0 ? durationSeconds : 0}
            step={0.1}
            value={Math.min(currentTimeSeconds, durationSeconds > 0 ? durationSeconds : 0)}
            disabled={!selectedPlaybackVersion || durationSeconds <= 0}
            onChange={(event) => handleSeek(Number(event.target.value))}
            title="Seek within the selected version."
          />

          <p className="muted">
            {formatTime(currentTimeSeconds)} / {formatTime(durationSeconds)}
          </p>

          {playbackError && <p className="error">{playbackError}</p>}
        </section>

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
                    onClick={() => setSelectedPlaybackVersionId(version.id)}
                    title="Set this version as the currently selected track for playback."
                  >
                    Cue
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void window.producerPlayer.revealFile(version.filePath);
                    }}
                    title="Reveal this file in Finder."
                  >
                    Reveal
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

          <label className="checkbox-row" title="Automatically move older versions into old/ folders while keeping the newest version in place.">
            <input
              type="checkbox"
              checked={snapshot.matcherSettings.autoMoveOld}
              onChange={(event) => {
                void handleSetAutoMoveOld(event.target.checked);
              }}
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
