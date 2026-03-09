import SwiftUI

struct SongListView: View {
    @ObservedObject var model: LibraryViewModel

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    var body: some View {
        VStack(spacing: 0) {
            controls
                .padding(12)

            Divider()

            List(model.rows) { row in
                Button {
                    model.selectRow(row)
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.title)
                                .font(.headline)
                                .lineLimit(1)
                            Text(row.versionLabel)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }

                        Spacer()

                        Text(row.lastExportAt.map { Self.dateFormatter.string(from: $0) } ?? "—")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowBackground(isSelected(row) ? Color.accentColor.opacity(0.15) : Color.clear)
                .onTapGesture(count: 2) {
                    model.selectRow(row)
                    model.playSelection()
                }
            }
            .listStyle(.inset)
        }
    }

    @ViewBuilder
    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TextField("Quick fuzzy search", text: Binding(
                    get: { model.searchText },
                    set: { model.updateSearch($0) }
                ))
                .textFieldStyle(.roundedBorder)

                if model.isIndexing {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            Picker("Display", selection: Binding(
                get: { model.displayMode },
                set: { model.setDisplayMode($0) }
            )) {
                ForEach(LibraryDisplayMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private func isSelected(_ row: SongListItem) -> Bool {
        if model.displayMode == .versions {
            return row.versionID == model.selectedVersionID
        }
        return row.songID == model.selectedSongID
    }
}
