import SwiftUI

struct InspectorView: View {
    @ObservedObject var model: LibraryViewModel

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                playerCard

                GroupBox("Version History") {
                    VStack(alignment: .leading, spacing: 8) {
                        if model.selectedSongVersions.isEmpty {
                            Text("No versions yet")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(model.selectedSongVersions) { version in
                                Button {
                                    model.selectVersion(version)
                                    model.playSelection()
                                } label: {
                                    HStack {
                                        Image(systemName: version.isActive ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(version.isActive ? Color.accentColor : Color.secondary)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(version.fileName)
                                                .lineLimit(1)
                                            Text(Self.dateFormatter.string(from: version.modifiedAt))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                GroupBox("Waveform Preview") {
                    if model.waveformSamples.isEmpty {
                        Text("Select a version to render waveform")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 130, alignment: .center)
                    } else {
                        WaveformView(samples: model.waveformSamples)
                    }
                }

                GroupBox("Matcher + Library Settings") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Fuzzy aggressiveness")
                            .font(.subheadline)
                            .fontWeight(.medium)
                        HStack {
                            Slider(value: Binding(
                                get: { model.fuzzyThreshold },
                                set: { model.setFuzzyThreshold($0) }
                            ), in: 0.4...0.95)
                            Text(String(format: "%.2f", model.fuzzyThreshold))
                                .font(.caption.monospacedDigit())
                                .frame(width: 40, alignment: .trailing)
                        }

                        Toggle("Auto-move old songs/versions to old/", isOn: Binding(
                            get: { model.autoMoveOldEnabled },
                            set: { model.setAutoMoveOld($0) }
                        ))
                    }
                }

                if !model.statusText.isEmpty {
                    Label(model.statusText, systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
        }
    }

    private var playerCard: some View {
        GroupBox("Now Playing") {
            VStack(alignment: .leading, spacing: 8) {
                Text(model.playback.nowPlayingTitle.isEmpty ? "—" : model.playback.nowPlayingTitle)
                    .font(.headline)
                    .lineLimit(1)

                if !model.selectedSongTitle.isEmpty {
                    Text(model.selectedSongTitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 12) {
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
                .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
