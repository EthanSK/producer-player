import Foundation
import SwiftUI
import AppKit
import UniformTypeIdentifiers

@MainActor
final class LibraryViewModel: ObservableObject {
    @Published var albums: [Album] = []
    @Published var rows: [SongListItem] = []

    @Published var selectedAlbumID: Int64?
    @Published var selectedSongID: Int64?
    @Published var selectedVersionID: Int64?

    @Published var selectedSongTitle: String = ""
    @Published var selectedSongVersions: [SongVersion] = []
    @Published var waveformSamples: [CGFloat] = []

    @Published var displayMode: LibraryDisplayMode = .logicalSongs
    @Published var searchText: String = ""
    @Published var pendingMatch: PendingMatch?

    @Published var isIndexing = false
    @Published var fuzzyThreshold: Double = 0.76
    @Published var autoMoveOldEnabled: Bool = true
    @Published var statusText: String = ""

    let playback = AudioPlaybackService()

    private let repository: LibraryRepository
    private let scanner: FileScanner
    private let watcher = FolderWatcher()
    private let notifications = NotificationService()
    private let waveformService = WaveformService()

    private var scanTimer: Timer?

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dataDir = appSupport.appendingPathComponent("ProducerPlayer", isDirectory: true)
        let dbURL = dataDir.appendingPathComponent("library.sqlite", isDirectory: false)

        do {
            repository = try LibraryRepository(databaseURL: dbURL)
        } catch {
            let fallback = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("producer-player.sqlite")
            repository = try! LibraryRepository(databaseURL: fallback)
        }

        scanner = FileScanner(repository: repository)

        Task {
            await scanner.setDelegate(self)
        }

        watcher.onChange = { [weak self] albumID in
            guard let self else { return }
            Task {
                await self.rescan(albumID: albumID)
            }
        }

        notifications.requestAuthorizationIfNeeded()
        Task { await bootstrap() }
    }

    deinit {
        scanTimer?.invalidate()
        watcher.stopAll()
    }

    func bootstrap() async {
        await reloadAlbums()
        await refreshRows()
        startPeriodicScanTimer()

        if selectedAlbumID == nil {
            selectedAlbumID = albums.first?.id
        }

        await scanAllAlbums()
    }

    func reloadAlbums() async {
        do {
            albums = try await repository.allAlbums()
            watcher.sync(albums: albums)
            if let selectedAlbumID,
               let selected = albums.first(where: { $0.id == selectedAlbumID }) {
                autoMoveOldEnabled = selected.autoMoveOld
            }
        } catch {
            statusText = "Failed to load albums: \(error.localizedDescription)"
        }
    }

    func refreshRows() async {
        do {
            rows = try await repository.rows(albumID: selectedAlbumID, query: searchText, mode: displayMode)
            if selectedSongID == nil {
                selectedSongID = rows.first?.songID
                selectedVersionID = rows.first?.versionID
            }
            await refreshSelectionDetails()
        } catch {
            statusText = "Failed to load rows: \(error.localizedDescription)"
        }
    }

    func refreshSelectionDetails() async {
        guard let selectedSongID else {
            selectedSongVersions = []
            selectedSongTitle = ""
            waveformSamples = []
            return
        }

        do {
            selectedSongVersions = try await repository.versions(for: selectedSongID)
            selectedSongTitle = try await repository.song(id: selectedSongID)?.title ?? ""

            if selectedVersionID == nil {
                selectedVersionID = selectedSongVersions.first(where: { $0.isActive })?.id ?? selectedSongVersions.first?.id
            }

            if let selectedVersion = selectedSongVersions.first(where: { $0.id == selectedVersionID }) {
                waveformSamples = await waveformService.samples(for: selectedVersion.fileURL)
            }
        } catch {
            statusText = "Failed to load song details: \(error.localizedDescription)"
        }
    }

    func selectAlbum(_ albumID: Int64?) {
        selectedAlbumID = albumID
        if let albumID,
           let album = albums.first(where: { $0.id == albumID }) {
            autoMoveOldEnabled = album.autoMoveOld
        }

        Task {
            await refreshRows()
            if let albumID,
               let album = albums.first(where: { $0.id == albumID }) {
                await scanner.scan(album: album)
            }
        }
    }

    func selectRow(_ row: SongListItem) {
        selectedSongID = row.songID
        selectedVersionID = row.versionID
        Task { await refreshSelectionDetails() }
    }

    func selectVersion(_ version: SongVersion) {
        selectedVersionID = version.id
        Task {
            waveformSamples = await waveformService.samples(for: version.fileURL)
        }
    }

    func updateSearch(_ text: String) {
        searchText = text
        Task { await refreshRows() }
    }

    func setDisplayMode(_ mode: LibraryDisplayMode) {
        displayMode = mode
        Task { await refreshRows() }
    }

    func setFuzzyThreshold(_ value: Double) {
        fuzzyThreshold = value
        Task { await scanner.updateFuzzyThreshold(value) }
    }

    func setAutoMoveOld(_ enabled: Bool) {
        guard let albumID = selectedAlbumID else { return }
        autoMoveOldEnabled = enabled
        Task {
            do {
                try await repository.updateAlbumAutoMove(albumID: albumID, enabled: enabled)
                await reloadAlbums()
            } catch {
                statusText = "Failed to update auto-move setting: \(error.localizedDescription)"
            }
        }
    }

    func addWatchFolderFromPicker() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = true

        if panel.runModal() == .OK {
            handleDroppedURLs(panel.urls)
        }
    }

    func handleDroppedURLs(_ urls: [URL]) {
        guard !urls.isEmpty else { return }

        Task {
            for url in urls {
                var folderURL = url
                var requestedName: String? = nil

                var isDirectory: ObjCBool = false
                FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)

                if isDirectory.boolValue {
                    folderURL = url
                    requestedName = url.lastPathComponent
                } else {
                    folderURL = url.deletingLastPathComponent()
                    requestedName = await nextAlbumName(base: "Album")
                }

                do {
                    let album = try await repository.upsertAlbum(path: folderURL.path, name: requestedName)
                    await reloadAlbums()
                    selectedAlbumID = album.id
                    await scanner.scan(album: album)
                } catch {
                    statusText = "Could not add watch folder: \(error.localizedDescription)"
                }
            }
            await refreshRows()
        }
    }

    func handleDropProviders(_ providers: [NSItemProvider]) -> Bool {
        let fileProviders = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
        guard !fileProviders.isEmpty else { return false }

        var collected: [URL] = []
        let lock = NSLock()
        let group = DispatchGroup()

        for provider in fileProviders {
            group.enter()
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                defer { group.leave() }

                if let data = item as? Data,
                   let url = URL(dataRepresentation: data, relativeTo: nil) {
                    lock.lock(); collected.append(url); lock.unlock()
                } else if let url = item as? URL {
                    lock.lock(); collected.append(url); lock.unlock()
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.handleDroppedURLs(collected)
        }

        return true
    }

    private func nextAlbumName(base: String) async -> String {
        let existing = Set(albums.map { $0.name.lowercased() })
        if !existing.contains(base.lowercased()) {
            return base
        }

        for i in 2...999 {
            let candidate = "\(base) \(i)"
            if !existing.contains(candidate.lowercased()) {
                return candidate
            }
        }
        return "\(base) \(UUID().uuidString.prefix(4))"
    }

    func scanAllAlbums() async {
        for album in albums {
            await scanner.scan(album: album)
        }
        await refreshRows()
    }

    func rescan(albumID: Int64) async {
        guard let album = albums.first(where: { $0.id == albumID }) else { return }
        await scanner.scan(album: album)
        await refreshRows()
    }

    func resolvePending(choice: PendingMatchChoice) {
        guard let pending = pendingMatch else { return }
        pendingMatch = nil

        Task {
            await scanner.resolvePendingMatch(pending, choice: choice)
            await refreshRows()
            await rescan(albumID: pending.albumID)
        }
    }

    func playSelection() {
        Task {
            let playlist = await buildPlaylistFromVisibleRows()
            guard !playlist.isEmpty else { return }

            let startVersionID: Int64? = {
                if let selectedVersionID { return selectedVersionID }
                if let selectedSongID {
                    return selectedSongVersions.first(where: { $0.songID == selectedSongID && $0.isActive })?.id
                }
                return playlist.first?.id
            }()

            playback.setPlaylist(playlist, startAt: startVersionID, autoplay: true)
        }
    }

    func togglePlayback() {
        playback.togglePlayPause()
    }

    func playNext() {
        playback.playNext()
    }

    func playPrevious() {
        playback.playPrevious()
    }

    private func buildPlaylistFromVisibleRows() async -> [SongVersion] {
        var versions: [SongVersion] = []
        versions.reserveCapacity(rows.count)

        for row in rows {
            if let versionID = row.versionID,
               let version = try? await repository.version(id: versionID) {
                versions.append(version)
                continue
            }

            if let active = try? await repository.activeVersion(for: row.songID) {
                versions.append(active)
            }
        }

        return versions
    }

    private func startPeriodicScanTimer() {
        scanTimer?.invalidate()
        scanTimer = Timer.scheduledTimer(withTimeInterval: 20.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task {
                await self.scanAllAlbums()
            }
        }
    }
}

// MARK: - FileScannerDelegate

@MainActor
extension LibraryViewModel: FileScannerDelegate {
    func scannerDidStartIndexing(albumID: Int64) {
        isIndexing = true
        statusText = "Indexing album..."
    }

    func scannerDidFinishIndexing(albumID: Int64) {
        isIndexing = false
        statusText = "Library up to date"
    }

    func scannerDidDetectPendingMatch(_ pending: PendingMatch) {
        pendingMatch = pending
        statusText = "Matcher needs confirmation"
    }

    func scannerDidDetectRerender(song: Song, version: SongVersion) {
        notifications.notifyRerender(songTitle: song.title, versionName: version.fileName)
        playback.reloadCurrentIfMatching(path: version.filePath)
        statusText = "Re-render detected for \(song.title)"

        Task {
            await waveformService.invalidate(path: version.filePath)
            await refreshRows()
        }
    }

    func scannerDidRemoveStaleEntries(albumID: Int64, removedCount: Int) {
        if removedCount > 0 {
            statusText = "Removed \(removedCount) stale file entries"
            Task { await refreshRows() }
        }
    }
}
