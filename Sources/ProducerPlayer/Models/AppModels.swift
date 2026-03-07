import Foundation

enum LibraryDisplayMode: String, CaseIterable, Identifiable, Codable {
    case logicalSongs = "Logical Songs"
    case versions = "Versions"

    var id: String { rawValue }
}

struct Album: Identifiable, Hashable, Codable {
    let id: Int64
    var name: String
    var path: String
    var autoMoveOld: Bool
    var createdAt: Date
    var updatedAt: Date
}

struct Song: Identifiable, Hashable, Codable {
    let id: Int64
    let albumID: Int64
    var title: String
    var normalizedTitle: String
    var createdAt: Date
    var updatedAt: Date
}

struct SongVersion: Identifiable, Hashable, Codable {
    let id: Int64
    let songID: Int64
    var filePath: String
    var fileName: String
    var fileStem: String
    var fileExtension: String
    var fileSize: Int64
    var modifiedAt: Date
    var createdAt: Date
    var isActive: Bool
    var archivedPath: String?

    var fileURL: URL { URL(fileURLWithPath: filePath) }
}

struct RegexRule: Identifiable, Hashable, Codable {
    let id: Int64
    let albumID: Int64
    var pattern: String
    var replacement: String
    var priority: Int
    var enabled: Bool
}

struct MatchFeedback: Identifiable, Hashable, Codable {
    let id: Int64
    let albumID: Int64
    var fileStem: String
    var songID: Int64
    var confidence: Double
    var createdAt: Date
}

struct MatchCandidate: Identifiable, Hashable {
    var id: Int64 { song.id }
    let song: Song
    let score: Double
    let reason: String
}

struct PendingMatch: Identifiable {
    let id = UUID()
    let albumID: Int64
    let albumPath: String
    let fileURL: URL
    let fileSize: Int64
    let modifiedAt: Date
    let candidates: [MatchCandidate]
}

enum PendingMatchChoice {
    case existingSong(Int64)
    case newSong(title: String?)
}

struct SongListItem: Identifiable, Hashable {
    let id: String
    let songID: Int64
    let versionID: Int64?
    let title: String
    let versionLabel: String
    let lastExportAt: Date?
    let filePath: String?
}

struct FileIndexRecord: Hashable {
    let path: String
    let albumID: Int64
    let fileSize: Int64
    let modifiedAt: Date
    let versionID: Int64?
}
