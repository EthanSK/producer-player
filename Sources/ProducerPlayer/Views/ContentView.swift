import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @ObservedObject var model: LibraryViewModel

    var body: some View {
        NavigationSplitView {
            SidebarView(model: model)
                .navigationTitle("Producer Player")
        } content: {
            SongListView(model: model)
                .navigationTitle(model.displayMode.rawValue)
        } detail: {
            InspectorView(model: model)
                .navigationTitle("Inspector")
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(item: $model.pendingMatch) { pending in
            MatchingConfirmationSheet(pending: pending) { choice in
                model.resolvePending(choice: choice)
            }
        }
        .onDrop(of: [UTType.fileURL], isTargeted: nil) { providers in
            model.handleDropProviders(providers)
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    model.playPrevious()
                } label: {
                    Image(systemName: "backward.fill")
                }

                Button {
                    model.playSelection()
                } label: {
                    Image(systemName: "play.fill")
                }

                Button {
                    model.togglePlayback()
                } label: {
                    Image(systemName: model.playback.isPlaying ? "pause.fill" : "playpause.fill")
                }

                Button {
                    model.playNext()
                } label: {
                    Image(systemName: "forward.fill")
                }
            }
        }
    }
}
