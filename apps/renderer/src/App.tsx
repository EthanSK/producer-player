import { useEffect, useMemo, useState } from 'react';
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
    fuzzyThreshold: 0.72,
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

function sortVersions(versions: SongVersion[]): SongVersion[] {
  return [...versions].sort(
    (left, right) =>
      new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime()
  );
}

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(EMPTY_SNAPSHOT);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('logicalSongs');
  const [searchText, setSearchText] = useState('');
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [folderPathInput, setFolderPathInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const songs = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (query.length === 0) {
      return snapshot.songs;
    }

    return snapshot.songs.filter((song) => {
      return (
        song.title.toLowerCase().includes(query) ||
        song.normalizedTitle.toLowerCase().includes(query)
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

  async function runAndCapture(task: () => Promise<LibrarySnapshot>): Promise<void> {
    setError(null);
    try {
      const next = await task();
      setSnapshot(next);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function handleLinkFolderPath(): void {
    const folderPath = folderPathInput.trim();
    if (!folderPath) {
      return;
    }

    void runAndCapture(() => window.producerPlayer.linkFolder(folderPath));
    setFolderPathInput('');
  }

  async function handleOpenFolderDialog(): Promise<void> {
    await runAndCapture(() => window.producerPlayer.linkFolderWithDialog());
  }

  async function handleUnlinkFolder(folderId: string): Promise<void> {
    await runAndCapture(() => window.producerPlayer.unlinkFolder(folderId));
  }

  async function handleRescan(): Promise<void> {
    await runAndCapture(() => window.producerPlayer.rescanLibrary());
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="panel panel-left">
        <header className="panel-header">
          <h2>Watch Folders</h2>
          <button
            type="button"
            onClick={() => {
              void handleOpenFolderDialog();
            }}
            data-testid="link-folder-dialog-button"
          >
            Add Folder…
          </button>
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
          />
          <button
            type="button"
            onClick={handleLinkFolderPath}
            data-testid="link-folder-path-button"
          >
            Link Path
          </button>
        </div>

        <ul className="folder-list">
          {snapshot.linkedFolders.map((folder) => (
            <li key={folder.id} className="folder-row" data-testid="linked-folder-item">
              <div>
                <strong>{folder.name}</strong>
                <p className="muted">{folder.path}</p>
                <p className="muted">{folder.fileCount} tracked files</p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void handleUnlinkFolder(folder.id);
                }}
              >
                Unlink
              </button>
            </li>
          ))}
          {snapshot.linkedFolders.length === 0 && (
            <li className="empty-state">No watch folders linked yet.</li>
          )}
        </ul>

        <section className="song-shortcuts">
          <h3>Logical Songs</h3>
          <ul>
            {songs.slice(0, 15).map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  className={song.id === selectedSongId ? 'selected' : ''}
                  onClick={() => setSelectedSongId(song.id)}
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
              className={displayMode === 'logicalSongs' ? 'active' : ''}
              data-testid="mode-logical-songs"
            >
              Logical Songs
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('versions')}
              className={displayMode === 'versions' ? 'active' : ''}
              data-testid="mode-versions"
            >
              Versions
            </button>
            <button type="button" onClick={() => void handleRescan()}>
              Rescan
            </button>
          </div>
        </header>

        <div className="filter-row">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Quick fuzzy search"
            data-testid="search-input"
          />
        </div>

        {displayMode === 'logicalSongs' ? (
          <ul className="main-list" data-testid="main-list">
            {songs.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  className={song.id === selectedSongId ? 'selected' : ''}
                  onClick={() => setSelectedSongId(song.id)}
                  data-testid="main-list-row"
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
                  onClick={() => setSelectedSongId(version.songId)}
                  data-testid="main-list-row"
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
                  <p className="muted">{Math.round(version.sizeBytes / 1024)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void window.producerPlayer.revealFile(version.filePath);
                  }}
                >
                  Reveal
                </button>
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
          <p className="muted">
            Fuzzy threshold {snapshot.matcherSettings.fuzzyThreshold.toFixed(2)} · Auto-move
            old {snapshot.matcherSettings.autoMoveOld ? 'ON' : 'OFF'}
          </p>
          {loading && <p className="muted">Loading snapshot…</p>}
          {error && <p className="error">{error}</p>}
        </section>
      </aside>
    </div>
  );
}
