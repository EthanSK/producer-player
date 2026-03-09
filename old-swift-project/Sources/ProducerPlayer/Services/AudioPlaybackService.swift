import Foundation
import AVFoundation

@MainActor
final class AudioPlaybackService: NSObject, ObservableObject {
    @Published private(set) var isPlaying = false
    @Published private(set) var nowPlayingVersionID: Int64?
    @Published private(set) var nowPlayingTitle: String = ""

    private let player = AVQueuePlayer()
    private var endObserver: NSObjectProtocol?

    private var playlist: [SongVersion] = []
    private var currentIndex: Int = 0

    override init() {
        super.init()
        player.actionAtItemEnd = .advance
        player.automaticallyWaitsToMinimizeStalling = false

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handleTrackEnded()
            }
        }
    }

    deinit {
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
    }

    func setPlaylist(_ versions: [SongVersion], startAt versionID: Int64? = nil, autoplay: Bool = true) {
        guard !versions.isEmpty else {
            stop()
            return
        }

        playlist = versions
        if let versionID,
           let index = versions.firstIndex(where: { $0.id == versionID }) {
            currentIndex = index
        } else {
            currentIndex = 0
        }

        rebuildQueue(autoplay: autoplay)
    }

    func play(version: SongVersion) {
        setPlaylist([version], startAt: version.id, autoplay: true)
    }

    func togglePlayPause() {
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }

    func playNext() {
        guard currentIndex + 1 < playlist.count else { return }
        currentIndex += 1
        rebuildQueue(autoplay: true)
    }

    func playPrevious() {
        guard currentIndex > 0 else { return }
        currentIndex -= 1
        rebuildQueue(autoplay: true)
    }

    func stop() {
        player.pause()
        player.removeAllItems()
        playlist.removeAll()
        isPlaying = false
        nowPlayingVersionID = nil
        nowPlayingTitle = ""
    }

    func reloadCurrentIfMatching(path: String) {
        guard let current = currentVersion(), current.filePath == path else { return }
        rebuildQueue(autoplay: isPlaying)
    }

    func currentVersion() -> SongVersion? {
        guard playlist.indices.contains(currentIndex) else { return nil }
        return playlist[currentIndex]
    }

    private func rebuildQueue(autoplay: Bool) {
        player.pause()
        player.removeAllItems()

        guard playlist.indices.contains(currentIndex) else {
            stop()
            return
        }

        let queueItems = playlist[currentIndex...].map { version in
            AVPlayerItem(url: version.fileURL)
        }

        for item in queueItems {
            player.insert(item, after: nil)
        }

        let current = playlist[currentIndex]
        nowPlayingVersionID = current.id
        nowPlayingTitle = current.fileName

        if autoplay {
            player.play()
            isPlaying = true
        } else {
            isPlaying = false
        }
    }

    private func handleTrackEnded() {
        guard currentIndex + 1 < playlist.count else {
            isPlaying = false
            return
        }

        currentIndex += 1
        let current = playlist[currentIndex]
        nowPlayingVersionID = current.id
        nowPlayingTitle = current.fileName

        // AVQueuePlayer already advanced, just ensure state stays accurate.
        if player.rate > 0 {
            isPlaying = true
        }
    }
}
