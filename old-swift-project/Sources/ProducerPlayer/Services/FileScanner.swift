import Foundation

@MainActor
protocol FileScannerDelegate: AnyObject {
    func scannerDidStartIndexing(albumID: Int64)
    func scannerDidFinishIndexing(albumID: Int64)
    func scannerDidDetectPendingMatch(_ pending: PendingMatch)
    func scannerDidDetectRerender(song: Song, version: SongVersion)
    func scannerDidRemoveStaleEntries(albumID: Int64, removedCount: Int)
}

actor FileScanner {
    private let repository: LibraryRepository
    private var matchingEngine: MatchingEngine
    private var scanningAlbumIDs: Set<Int64> = []
    private var pendingPaths: Set<String> = []

    private weak var delegate: (any FileScannerDelegate)?

    private let supportedExtensions = Set(["wav", "aiff", "flac", "mp3", "m4a"])

    init(repository: LibraryRepository, matchingEngine: MatchingEngine = MatchingEngine()) {
        self.repository = repository
        self.matchingEngine = matchingEngine
    }

    func setDelegate(_ delegate: (any FileScannerDelegate)?) {
        self.delegate = delegate
    }

    func updateFuzzyThreshold(_ threshold: Double) {
        matchingEngine.fuzzyThreshold = max(0.4, min(0.98, threshold))
    }

    func scan(album: Album) async {
        if scanningAlbumIDs.contains(album.id) {
            return
        }
        scanningAlbumIDs.insert(album.id)
        await notifyStart(albumID: album.id)

        defer {
            scanningAlbumIDs.remove(album.id)
        }

        let rootURL = URL(fileURLWithPath: album.path)
        guard FileManager.default.fileExists(atPath: album.path) else {
            await notifyFinish(albumID: album.id)
            return
        }

        do {
            var songs = try await repository.songs(in: album.id)
            let regexRules = try await repository.regexRules(albumID: album.id)
            let feedback = try await repository.matcherFeedback(albumID: album.id)

            var seenPaths: Set<String> = []

            let enumerator = FileManager.default.enumerator(
                at: rootURL,
                includingPropertiesForKeys: [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey],
                options: [.skipsHiddenFiles]
            )

            while let fileURL = enumerator?.nextObject() as? URL {
                guard supportedExtensions.contains(fileURL.pathExtension.lowercased()) else { continue }

                let values = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey])
                guard values.isRegularFile == true else { continue }

                let modifiedAt = values.contentModificationDate ?? Date()
                let fileSize = Int64(values.fileSize ?? 0)
                seenPaths.insert(fileURL.path)

                if let index = try await repository.fileIndexRecord(path: fileURL.path),
                   index.albumID == album.id,
                   index.fileSize == fileSize,
                   abs(index.modifiedAt.timeIntervalSince1970 - modifiedAt.timeIntervalSince1970) < 0.001 {
                    continue
                }

                let rawStem = fileURL.audioFileStem
                let outcome = matchingEngine.match(
                    fileStem: rawStem,
                    songs: songs,
                    regexRules: regexRules,
                    feedback: feedback
                )

                switch outcome {
                case .matched(let candidate):
                    let result = try await repository.addVersion(
                        song: candidate.song,
                        album: album,
                        fileURL: fileURL,
                        fileSize: fileSize,
                        modifiedAt: modifiedAt
                    )

                    if result.rerender {
                        await notifyRerender(song: candidate.song, version: result.version)
                    }

                case .uncertain(let candidates):
                    try await repository.upsertFileIndex(
                        path: fileURL.path,
                        albumID: album.id,
                        fileSize: fileSize,
                        modifiedAt: modifiedAt,
                        versionID: nil
                    )

                    if !pendingPaths.contains(fileURL.path) {
                        pendingPaths.insert(fileURL.path)
                        let pending = PendingMatch(
                            albumID: album.id,
                            albumPath: album.path,
                            fileURL: fileURL,
                            fileSize: fileSize,
                            modifiedAt: modifiedAt,
                            candidates: candidates
                        )
                        await notifyPendingMatch(pending)
                    }

                case .newSong:
                    let createdSong = try await repository.ensureSong(albumID: album.id, title: rawStem)
                    songs.insert(createdSong, at: 0)

                    _ = try await repository.addVersion(
                        song: createdSong,
                        album: album,
                        fileURL: fileURL,
                        fileSize: fileSize,
                        modifiedAt: modifiedAt
                    )
                }
            }

            let removed = try await repository.purgeMissing(albumID: album.id, seenPaths: seenPaths)
            if removed > 0 {
                await notifyStaleRemoved(albumID: album.id, removedCount: removed)
            }

        } catch {
            // ignored for MVP; next periodic scan will retry.
        }

        await notifyFinish(albumID: album.id)
    }

    func resolvePendingMatch(_ pending: PendingMatch, choice: PendingMatchChoice) async {
        pendingPaths.remove(pending.fileURL.path)

        do {
            guard let album = try await repository.album(id: pending.albumID) else { return }

            let song: Song
            switch choice {
            case .existingSong(let songID):
                guard let existing = try await repository.song(id: songID) else { return }
                song = existing
                try await repository.recordFeedback(
                    albumID: pending.albumID,
                    fileStem: pending.fileURL.audioFileStem,
                    songID: songID,
                    confidence: 0.95
                )

            case .newSong(let title):
                let resolvedTitle = title?.isEmpty == false ? title! : pending.fileURL.audioFileStem
                song = try await repository.ensureSong(albumID: pending.albumID, title: resolvedTitle)
            }

            let result = try await repository.addVersion(
                song: song,
                album: album,
                fileURL: pending.fileURL,
                fileSize: pending.fileSize,
                modifiedAt: pending.modifiedAt
            )

            if result.rerender {
                await notifyRerender(song: song, version: result.version)
            }

        } catch {
            // ignored for MVP; failure will be recovered by next scan.
        }
    }

    private func notifyStart(albumID: Int64) async {
        let delegate = self.delegate
        await MainActor.run {
            delegate?.scannerDidStartIndexing(albumID: albumID)
        }
    }

    private func notifyFinish(albumID: Int64) async {
        let delegate = self.delegate
        await MainActor.run {
            delegate?.scannerDidFinishIndexing(albumID: albumID)
        }
    }

    private func notifyPendingMatch(_ pending: PendingMatch) async {
        let delegate = self.delegate
        await MainActor.run {
            delegate?.scannerDidDetectPendingMatch(pending)
        }
    }

    private func notifyRerender(song: Song, version: SongVersion) async {
        let delegate = self.delegate
        await MainActor.run {
            delegate?.scannerDidDetectRerender(song: song, version: version)
        }
    }

    private func notifyStaleRemoved(albumID: Int64, removedCount: Int) async {
        let delegate = self.delegate
        await MainActor.run {
            delegate?.scannerDidRemoveStaleEntries(albumID: albumID, removedCount: removedCount)
        }
    }
}
