import SwiftUI

struct SidebarView: View {
    @ObservedObject var model: LibraryViewModel

    private var sidebarSongs: [(songID: Int64, title: String)] {
        var seen: Set<Int64> = []
        return model.rows.compactMap { row in
            guard !seen.contains(row.songID) else { return nil }
            seen.insert(row.songID)
            return (row.songID, row.title)
        }
    }

    var body: some View {
        List {
            Section("Watch Folders") {
                ForEach(model.albums) { album in
                    Button {
                        model.selectAlbum(album.id)
                    } label: {
                        HStack {
                            Image(systemName: model.selectedAlbumID == album.id ? "folder.fill" : "folder")
                            Text(album.name)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            Section("Songs") {
                ForEach(sidebarSongs, id: \.songID) { song in
                    Button {
                        if let row = model.rows.first(where: { $0.songID == song.songID }) {
                            model.selectRow(row)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "music.note")
                            Text(song.title)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .safeAreaInset(edge: .top) {
            HStack {
                Button {
                    model.addWatchFolderFromPicker()
                } label: {
                    Label("Add Folder", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                Spacer()
            }
            .padding([.horizontal, .top], 10)
        }
    }
}
