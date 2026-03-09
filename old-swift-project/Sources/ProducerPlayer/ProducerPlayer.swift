import SwiftUI

@main
struct ProducerPlayerApp: App {
    @StateObject private var model = LibraryViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .frame(minWidth: 1180, minHeight: 760)
        }
        .commands {
            PlaybackCommands(model: model)
        }
    }
}

struct PlaybackCommands: Commands {
    @ObservedObject var model: LibraryViewModel

    var body: some Commands {
        CommandMenu("Playback") {
            Button("Play Selected") {
                model.playSelection()
            }
            .keyboardShortcut(.return, modifiers: [])

            Button(model.playback.isPlaying ? "Pause" : "Play/Pause") {
                model.togglePlayback()
            }
            .keyboardShortcut(.space, modifiers: [])

            Divider()

            Button("Previous") {
                model.playPrevious()
            }
            .keyboardShortcut("[", modifiers: [])

            Button("Next") {
                model.playNext()
            }
            .keyboardShortcut("]", modifiers: [])
        }

        CommandMenu("Library") {
            Button("Add Watch Folder…") {
                model.addWatchFolderFromPicker()
            }
            .keyboardShortcut("o", modifiers: [.command])

            Button("Rescan All") {
                Task { await model.scanAllAlbums() }
            }
            .keyboardShortcut("r", modifiers: [.command, .shift])
        }
    }
}
