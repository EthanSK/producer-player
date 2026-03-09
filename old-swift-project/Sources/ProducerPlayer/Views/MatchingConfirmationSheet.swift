import SwiftUI

struct MatchingConfirmationSheet: View {
    let pending: PendingMatch
    let onResolve: (PendingMatchChoice) -> Void

    @State private var selectedSongID: Int64?
    @State private var customTitle: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Best-effort match confirmation")
                .font(.title3.bold())

            Text("Is **\(pending.fileURL.lastPathComponent)** a new version of an existing logical song?")
                .fixedSize(horizontal: false, vertical: true)

            List(selection: $selectedSongID) {
                ForEach(pending.candidates) { candidate in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(candidate.song.title)
                                .fontWeight(.medium)
                            Spacer()
                            Text(String(format: "%.0f%%", candidate.score * 100))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        Text(candidate.reason)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .tag(candidate.song.id)
                }
            }
            .frame(height: 180)

            TextField("If new song, optional title", text: $customTitle)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("Use Selected Match") {
                    if let selectedSongID {
                        onResolve(.existingSong(selectedSongID))
                    }
                }
                .disabled(selectedSongID == nil)

                Button("Create New Song") {
                    onResolve(.newSong(title: customTitle.trimmingCharacters(in: .whitespacesAndNewlines)))
                }

                Spacer()
            }
            .padding(.top, 4)
        }
        .padding(16)
        .frame(minWidth: 520, minHeight: 360)
    }
}
