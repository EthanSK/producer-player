import Foundation
import Dispatch
import Darwin

final class FolderWatcher {
    private struct WatchHandle {
        let fd: Int32
        let source: DispatchSourceFileSystemObject
    }

    private let queue = DispatchQueue(label: "producerplayer.folderwatcher", qos: .utility)
    private var handles: [Int64: WatchHandle] = [:]
    private var pendingDebounce: [Int64: DispatchWorkItem] = [:]

    var onChange: ((Int64) -> Void)?

    deinit {
        stopAll()
    }

    func sync(albums: [Album]) {
        queue.async { [weak self] in
            guard let self else { return }
            let validIDs = Set(albums.map(\.id))

            for id in self.handles.keys where !validIDs.contains(id) {
                self.stop(id: id)
            }

            for album in albums where self.handles[album.id] == nil {
                self.start(album: album)
            }
        }
    }

    func stopAll() {
        queue.sync {
            for id in handles.keys {
                stop(id: id)
            }
            handles.removeAll()
        }
    }

    private func start(album: Album) {
        let fd = open(album.path, O_EVTONLY)
        guard fd >= 0 else { return }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .extend, .attrib, .delete, .rename, .revoke],
            queue: queue
        )

        source.setEventHandler { [weak self] in
            self?.scheduleDebouncedChange(albumID: album.id)
        }

        source.setCancelHandler {
            close(fd)
        }

        source.resume()
        handles[album.id] = WatchHandle(fd: fd, source: source)
    }

    private func stop(id: Int64) {
        if let handle = handles[id] {
            handle.source.cancel()
        }
        handles[id] = nil
        pendingDebounce[id]?.cancel()
        pendingDebounce[id] = nil
    }

    private func scheduleDebouncedChange(albumID: Int64) {
        pendingDebounce[albumID]?.cancel()

        let work = DispatchWorkItem { [weak self] in
            self?.onChange?(albumID)
            self?.pendingDebounce[albumID] = nil
        }

        pendingDebounce[albumID] = work
        queue.asyncAfter(deadline: .now() + 0.25, execute: work)
    }
}
