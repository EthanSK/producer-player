import Foundation

actor LibraryRepository {
    private let db: SQLiteDatabase
    private let fileManager = FileManager.default

    init(databaseURL: URL) throws {
        let directory = databaseURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
        db = try SQLiteDatabase(path: databaseURL.path)
        try Self.bootstrapSchema(db: db)
    }

    private static func bootstrapSchema(db: SQLiteDatabase) throws {
        try db.execute(
            """
            CREATE TABLE IF NOT EXISTS albums (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                auto_move_old INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            """
        )

        try db.execute(
            """
            CREATE TABLE IF NOT EXISTS songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                album_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                normalized_title TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                UNIQUE(album_id, normalized_title),
                FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
            );
            """
        )

        try db.execute("CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album_id);")
        try db.execute("CREATE INDEX IF NOT EXISTS idx_songs_norm ON songs(album_id, normalized_title);")

        try db.execute(
            """
            CREATE TABLE IF NOT EXISTS versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                song_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_stem TEXT NOT NULL,
                file_ext TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                modified_at REAL NOT NULL,
                created_at REAL NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                archived_path TEXT,
                FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
            );
            """
        )

        try db.execute("CREATE INDEX IF NOT EXISTS idx_versions_song ON versions(song_id);")
        try db.execute("CREATE INDEX IF NOT EXISTS idx_versions_active ON versions(song_id, is_active);")
        try db.execute("CREATE INDEX IF NOT EXISTS idx_versions_path ON versions(file_path);")

        try db.execute(
            """
            CREATE TABLE IF NOT EXISTS file_index (
                path TEXT PRIMARY KEY,
                album_id INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                modified_at REAL NOT NULL,
                version_id INTEGER,
                FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE,
                FOREIGN KEY(version_id) REFERENCES versions(id) ON DELETE SET NULL
            );
            """
        )

        try db.execute(
            """
            CREATE TABLE IF NOT EXISTS regex_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                album_id INTEGER NOT NULL,
                pattern TEXT NOT NULL,
                replacement TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 100,
                enabled INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
            );
            """
        )

        try db.execute("CREATE INDEX IF NOT EXISTS idx_regex_album ON regex_rules(album_id, priority);")

        try db.execute(
            """
            CREATE TABLE IF NOT EXISTS matcher_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                album_id INTEGER NOT NULL,
                file_stem TEXT NOT NULL,
                song_id INTEGER NOT NULL,
                confidence REAL NOT NULL,
                created_at REAL NOT NULL,
                FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE,
                FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
            );
            """
        )

        try db.execute("CREATE INDEX IF NOT EXISTS idx_feedback_album_stem ON matcher_feedback(album_id, file_stem);")
    }

    // MARK: - Album

    func allAlbums() throws -> [Album] {
        let rows = try db.query(
            """
            SELECT id, name, path, auto_move_old, created_at, updated_at
            FROM albums
            ORDER BY created_at ASC;
            """
        )
        return rows.compactMap(album(from:))
    }

    func album(id: Int64) throws -> Album? {
        let rows = try db.query(
            "SELECT id, name, path, auto_move_old, created_at, updated_at FROM albums WHERE id = ? LIMIT 1;",
            bindings: [.int(id)]
        )
        return rows.compactMap(album(from:)).first
    }

    func upsertAlbum(path: String, name: String? = nil, autoMoveOld: Bool = true) throws -> Album {
        let now = Date().timeIntervalSince1970
        let displayName = (name?.isEmpty == false ? name! : URL(fileURLWithPath: path).lastPathComponent)

        if let existing = try db.query(
            "SELECT id, name, path, auto_move_old, created_at, updated_at FROM albums WHERE path = ? LIMIT 1;",
            bindings: [.text(path)]
        ).compactMap(album(from:)).first {
            try db.execute(
                "UPDATE albums SET name = ?, updated_at = ? WHERE id = ?;",
                bindings: [.text(displayName), .double(now), .int(existing.id)]
            )
            return try album(id: existing.id) ?? existing
        }

        try db.execute(
            "INSERT INTO albums (name, path, auto_move_old, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
            bindings: [.text(displayName), .text(path), .int(autoMoveOld ? 1 : 0), .double(now), .double(now)]
        )

        let albumID = db.lastInsertedRowID()
        try seedDefaultRegexRules(albumID: albumID)

        guard let created = try album(id: albumID) else {
            throw SQLiteError.step("Album insert failed")
        }
        return created
    }

    func updateAlbumAutoMove(albumID: Int64, enabled: Bool) throws {
        let now = Date().timeIntervalSince1970
        try db.execute(
            "UPDATE albums SET auto_move_old = ?, updated_at = ? WHERE id = ?;",
            bindings: [.int(enabled ? 1 : 0), .double(now), .int(albumID)]
        )
    }

    private func seedDefaultRegexRules(albumID: Int64) throws {
        let rows = try db.query("SELECT id FROM regex_rules WHERE album_id = ? LIMIT 1;", bindings: [.int(albumID)])
        if !rows.isEmpty { return }

        try db.execute(
            "INSERT INTO regex_rules (album_id, pattern, replacement, priority, enabled) VALUES (?, ?, ?, ?, ?);",
            bindings: [
                .int(albumID),
                .text("(.+?)(?:\\s+v\\d+|\\s+ver\\d+|\\s+master|\\s+final|\\s+mixdown|\\s+render|\\s+bounce)?$"),
                .text("$1"),
                .int(10),
                .int(1)
            ]
        )

        try db.execute(
            "INSERT INTO regex_rules (album_id, pattern, replacement, priority, enabled) VALUES (?, ?, ?, ?, ?);",
            bindings: [
                .int(albumID),
                .text("(.+?)(?:\\s*\\(.*\\)|\\s*\\[.*\\])$"),
                .text("$1"),
                .int(20),
                .int(1)
            ]
        )
    }

    // MARK: - Songs / Versions

    func songs(in albumID: Int64) throws -> [Song] {
        let rows = try db.query(
            """
            SELECT id, album_id, title, normalized_title, created_at, updated_at
            FROM songs
            WHERE album_id = ?
            ORDER BY updated_at DESC;
            """,
            bindings: [.int(albumID)]
        )
        return rows.compactMap(song(from:))
    }

    func song(id: Int64) throws -> Song? {
        let rows = try db.query(
            "SELECT id, album_id, title, normalized_title, created_at, updated_at FROM songs WHERE id = ? LIMIT 1;",
            bindings: [.int(id)]
        )
        return rows.compactMap(song(from:)).first
    }

    func ensureSong(albumID: Int64, title: String) throws -> Song {
        let normalized = title.normalizedSongKey()
        let now = Date().timeIntervalSince1970

        if let existing = try db.query(
            "SELECT id, album_id, title, normalized_title, created_at, updated_at FROM songs WHERE album_id = ? AND normalized_title = ? LIMIT 1;",
            bindings: [.int(albumID), .text(normalized)]
        ).compactMap(song(from:)).first {
            if existing.title != title {
                try db.execute(
                    "UPDATE songs SET title = ?, updated_at = ? WHERE id = ?;",
                    bindings: [.text(title), .double(now), .int(existing.id)]
                )
            }
            return try song(id: existing.id) ?? existing
        }

        try db.execute(
            "INSERT INTO songs (album_id, title, normalized_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
            bindings: [.int(albumID), .text(title), .text(normalized), .double(now), .double(now)]
        )

        let songID = db.lastInsertedRowID()
        guard let created = try song(id: songID) else {
            throw SQLiteError.step("Song insert failed")
        }
        return created
    }

    func versions(for songID: Int64) throws -> [SongVersion] {
        let rows = try db.query(
            """
            SELECT id, song_id, file_path, file_name, file_stem, file_ext, file_size,
                   modified_at, created_at, is_active, archived_path
            FROM versions
            WHERE song_id = ?
            ORDER BY created_at DESC;
            """,
            bindings: [.int(songID)]
        )
        return rows.compactMap(version(from:))
    }

    func activeVersion(for songID: Int64) throws -> SongVersion? {
        let rows = try db.query(
            """
            SELECT id, song_id, file_path, file_name, file_stem, file_ext, file_size,
                   modified_at, created_at, is_active, archived_path
            FROM versions
            WHERE song_id = ? AND is_active = 1
            ORDER BY created_at DESC
            LIMIT 1;
            """,
            bindings: [.int(songID)]
        )
        return rows.compactMap(version(from:)).first
    }

    func version(for path: String) throws -> SongVersion? {
        let rows = try db.query(
            """
            SELECT id, song_id, file_path, file_name, file_stem, file_ext, file_size,
                   modified_at, created_at, is_active, archived_path
            FROM versions
            WHERE file_path = ?
            ORDER BY created_at DESC
            LIMIT 1;
            """,
            bindings: [.text(path)]
        )
        return rows.compactMap(version(from:)).first
    }

    func addVersion(
        song: Song,
        album: Album,
        fileURL: URL,
        fileSize: Int64,
        modifiedAt: Date
    ) throws -> (version: SongVersion, rerender: Bool) {
        let now = Date().timeIntervalSince1970
        let filePath = fileURL.path
        let fileName = fileURL.lastPathComponent
        let fileStem = fileURL.audioFileStem
        let fileExt = fileURL.pathExtension.lowercased()

        let existingForPath = try db.query(
            """
            SELECT id, song_id, file_path, file_name, file_stem, file_ext, file_size,
                   modified_at, created_at, is_active, archived_path
            FROM versions
            WHERE song_id = ? AND file_path = ?
            ORDER BY created_at DESC
            LIMIT 1;
            """,
            bindings: [.int(song.id), .text(filePath)]
        ).compactMap(version(from:)).first

        if let existing = existingForPath,
           existing.fileSize == fileSize,
           abs(existing.modifiedAt.timeIntervalSince1970 - modifiedAt.timeIntervalSince1970) < 0.001 {
            try upsertFileIndex(path: filePath, albumID: album.id, fileSize: fileSize, modifiedAt: modifiedAt, versionID: existing.id)
            return (existing, false)
        }

        let previousActive = try activeVersion(for: song.id)
        if let previousActive {
            try db.execute("UPDATE versions SET is_active = 0 WHERE id = ?;", bindings: [.int(previousActive.id)])

            if album.autoMoveOld,
               previousActive.filePath != filePath,
               fileManager.fileExists(atPath: previousActive.filePath) {
                if let archivedPath = try archiveOldVersion(at: previousActive.filePath, albumRoot: album.path) {
                    try db.execute(
                        "UPDATE versions SET archived_path = ?, file_path = ? WHERE id = ?;",
                        bindings: [.text(archivedPath), .text(archivedPath), .int(previousActive.id)]
                    )
                }
            }
        }

        try db.execute(
            """
            INSERT INTO versions (
                song_id, file_path, file_name, file_stem, file_ext, file_size,
                modified_at, created_at, is_active, archived_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL);
            """,
            bindings: [
                .int(song.id),
                .text(filePath),
                .text(fileName),
                .text(fileStem),
                .text(fileExt),
                .int(fileSize),
                .double(modifiedAt.timeIntervalSince1970),
                .double(now)
            ]
        )

        let versionID = db.lastInsertedRowID()

        try db.execute(
            "UPDATE songs SET updated_at = ? WHERE id = ?;",
            bindings: [.double(now), .int(song.id)]
        )

        try upsertFileIndex(
            path: filePath,
            albumID: album.id,
            fileSize: fileSize,
            modifiedAt: modifiedAt,
            versionID: versionID
        )

        guard let version = try version(id: versionID) else {
            throw SQLiteError.step("Version insert failed")
        }

        return (version, previousActive != nil)
    }

    func version(id: Int64) throws -> SongVersion? {
        let rows = try db.query(
            """
            SELECT id, song_id, file_path, file_name, file_stem, file_ext, file_size,
                   modified_at, created_at, is_active, archived_path
            FROM versions
            WHERE id = ?
            LIMIT 1;
            """,
            bindings: [.int(id)]
        )
        return rows.compactMap(version(from:)).first
    }

    // MARK: - Query rows for UI

    func rows(albumID: Int64?, query: String, mode: LibraryDisplayMode) throws -> [SongListItem] {
        switch mode {
        case .logicalSongs:
            let rows = try db.query(
                """
                SELECT
                    s.id AS song_id,
                    s.title AS title,
                    MAX(v.modified_at) AS last_export_at,
                    COUNT(v.id) AS version_count,
                    av.id AS active_version_id,
                    av.file_name AS active_file_name,
                    av.file_path AS active_file_path
                FROM songs s
                LEFT JOIN versions v ON v.song_id = s.id
                LEFT JOIN versions av ON av.song_id = s.id AND av.is_active = 1
                WHERE (? IS NULL OR s.album_id = ?)
                GROUP BY s.id, s.title, av.id, av.file_name, av.file_path
                ORDER BY COALESCE(MAX(v.modified_at), s.updated_at) DESC;
                """,
                bindings: [albumID.map(SQLiteValue.int) ?? .null, albumID.map(SQLiteValue.int) ?? .null]
            )

            return rows.compactMap { row in
                guard
                    let songID = row["song_id"]?.intValue,
                    let title = row["title"]?.textValue
                else { return nil }

                let versionCount = Int(row["version_count"]?.intValue ?? 0)
                let activeName = row["active_file_name"]?.textValue ?? "—"
                let versionLabel = versionCount > 0 ? "\(versionCount) versions • active: \(activeName)" : "No versions yet"
                let lastExport = row["last_export_at"].flatMap(sqlDate)
                let activeVersionID = row["active_version_id"]?.intValue
                let filePath = row["active_file_path"]?.textValue

                return SongListItem(
                    id: "song-\(songID)",
                    songID: songID,
                    versionID: activeVersionID,
                    title: title,
                    versionLabel: versionLabel,
                    lastExportAt: lastExport,
                    filePath: filePath
                )
            }.filter { item in
                filterItem(item, query: query)
            }

        case .versions:
            let rows = try db.query(
                """
                SELECT
                    s.id AS song_id,
                    s.title AS title,
                    v.id AS version_id,
                    v.file_name AS file_name,
                    v.modified_at AS modified_at,
                    v.file_path AS file_path
                FROM versions v
                JOIN songs s ON s.id = v.song_id
                WHERE (? IS NULL OR s.album_id = ?)
                ORDER BY v.modified_at DESC;
                """,
                bindings: [albumID.map(SQLiteValue.int) ?? .null, albumID.map(SQLiteValue.int) ?? .null]
            )

            return rows.compactMap { row in
                guard
                    let songID = row["song_id"]?.intValue,
                    let versionID = row["version_id"]?.intValue,
                    let title = row["title"]?.textValue,
                    let fileName = row["file_name"]?.textValue
                else { return nil }

                return SongListItem(
                    id: "version-\(versionID)",
                    songID: songID,
                    versionID: versionID,
                    title: title,
                    versionLabel: fileName,
                    lastExportAt: row["modified_at"].flatMap(sqlDate),
                    filePath: row["file_path"]?.textValue
                )
            }.filter { item in
                filterItem(item, query: query)
            }
        }
    }

    private func filterItem(_ item: SongListItem, query: String) -> Bool {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty { return true }
        let normalizedQuery = query.normalizedSongKey()
        let title = item.title.normalizedSongKey()
        if title.contains(normalizedQuery) { return true }
        return title.fuzzySimilarity(to: normalizedQuery) >= 0.52
    }

    // MARK: - Regex + feedback

    func regexRules(albumID: Int64) throws -> [RegexRule] {
        let rows = try db.query(
            """
            SELECT id, album_id, pattern, replacement, priority, enabled
            FROM regex_rules
            WHERE album_id = ?
            ORDER BY priority ASC, id ASC;
            """,
            bindings: [.int(albumID)]
        )

        return rows.compactMap { row in
            guard
                let id = row["id"]?.intValue,
                let albumID = row["album_id"]?.intValue,
                let pattern = row["pattern"]?.textValue,
                let replacement = row["replacement"]?.textValue,
                let priority = row["priority"]?.intValue,
                let enabled = row["enabled"]?.intValue
            else {
                return nil
            }
            return RegexRule(
                id: id,
                albumID: albumID,
                pattern: pattern,
                replacement: replacement,
                priority: Int(priority),
                enabled: enabled == 1
            )
        }
    }

    func matcherFeedback(albumID: Int64) throws -> [MatchFeedback] {
        let rows = try db.query(
            """
            SELECT id, album_id, file_stem, song_id, confidence, created_at
            FROM matcher_feedback
            WHERE album_id = ?
            ORDER BY created_at DESC;
            """,
            bindings: [.int(albumID)]
        )

        return rows.compactMap { row in
            guard
                let id = row["id"]?.intValue,
                let albumID = row["album_id"]?.intValue,
                let fileStem = row["file_stem"]?.textValue,
                let songID = row["song_id"]?.intValue,
                let confidence = row["confidence"]?.doubleValue,
                let createdAt = row["created_at"]?.doubleValue
            else {
                return nil
            }
            return MatchFeedback(
                id: id,
                albumID: albumID,
                fileStem: fileStem,
                songID: songID,
                confidence: confidence,
                createdAt: Date(timeIntervalSince1970: createdAt)
            )
        }
    }

    func recordFeedback(albumID: Int64, fileStem: String, songID: Int64, confidence: Double) throws {
        try db.execute(
            "INSERT INTO matcher_feedback (album_id, file_stem, song_id, confidence, created_at) VALUES (?, ?, ?, ?, ?);",
            bindings: [
                .int(albumID),
                .text(fileStem.normalizedSongKey()),
                .int(songID),
                .double(confidence),
                .double(Date().timeIntervalSince1970)
            ]
        )
    }

    // MARK: - File index / incremental scanning

    func fileIndexRecord(path: String) throws -> FileIndexRecord? {
        let rows = try db.query(
            "SELECT path, album_id, file_size, modified_at, version_id FROM file_index WHERE path = ? LIMIT 1;",
            bindings: [.text(path)]
        )

        guard let row = rows.first,
              let path = row["path"]?.textValue,
              let albumID = row["album_id"]?.intValue,
              let fileSize = row["file_size"]?.intValue,
              let modified = row["modified_at"]?.doubleValue
        else {
            return nil
        }

        return FileIndexRecord(
            path: path,
            albumID: albumID,
            fileSize: fileSize,
            modifiedAt: Date(timeIntervalSince1970: modified),
            versionID: row["version_id"]?.intValue
        )
    }

    func upsertFileIndex(path: String, albumID: Int64, fileSize: Int64, modifiedAt: Date, versionID: Int64?) throws {
        let rows = try db.query("SELECT path FROM file_index WHERE path = ? LIMIT 1;", bindings: [.text(path)])
        if rows.isEmpty {
            try db.execute(
                "INSERT INTO file_index (path, album_id, file_size, modified_at, version_id) VALUES (?, ?, ?, ?, ?);",
                bindings: [.text(path), .int(albumID), .int(fileSize), .double(modifiedAt.timeIntervalSince1970), versionID.map(SQLiteValue.int) ?? .null]
            )
        } else {
            try db.execute(
                "UPDATE file_index SET album_id = ?, file_size = ?, modified_at = ?, version_id = ? WHERE path = ?;",
                bindings: [.int(albumID), .int(fileSize), .double(modifiedAt.timeIntervalSince1970), versionID.map(SQLiteValue.int) ?? .null, .text(path)]
            )
        }
    }

    func purgeMissing(albumID: Int64, seenPaths: Set<String>) throws -> Int {
        let rows = try db.query(
            "SELECT path FROM file_index WHERE album_id = ?;",
            bindings: [.int(albumID)]
        )

        let known = Set(rows.compactMap { $0["path"]?.textValue })
        let missing = known.subtracting(seenPaths)
        guard !missing.isEmpty else { return 0 }

        var removedCount = 0
        for path in missing {
            try db.execute("DELETE FROM file_index WHERE path = ?;", bindings: [.text(path)])

            let versions = try db.query("SELECT id, song_id FROM versions WHERE file_path = ?;", bindings: [.text(path)])
            for row in versions {
                if let versionID = row["id"]?.intValue {
                    removedCount += 1
                    try db.execute("DELETE FROM versions WHERE id = ?;", bindings: [.int(versionID)])
                }

                if let songID = row["song_id"]?.intValue {
                    try ensureSongConsistency(songID: songID)
                }
            }
        }

        return removedCount
    }

    private func ensureSongConsistency(songID: Int64) throws {
        let countRows = try db.query("SELECT COUNT(*) AS c FROM versions WHERE song_id = ?;", bindings: [.int(songID)])
        let count = countRows.first?["c"]?.intValue ?? 0

        if count == 0 {
            try db.execute("DELETE FROM songs WHERE id = ?;", bindings: [.int(songID)])
            return
        }

        let activeRows = try db.query("SELECT id FROM versions WHERE song_id = ? AND is_active = 1 LIMIT 1;", bindings: [.int(songID)])
        if activeRows.isEmpty {
            if let newest = try db.query(
                "SELECT id FROM versions WHERE song_id = ? ORDER BY modified_at DESC, created_at DESC LIMIT 1;",
                bindings: [.int(songID)]
            ).first?["id"]?.intValue {
                try db.execute("UPDATE versions SET is_active = 1 WHERE id = ?;", bindings: [.int(newest)])
            }
        }
    }

    // MARK: - Helpers

    private func archiveOldVersion(at sourcePath: String, albumRoot: String) throws -> String? {
        let sourceURL = URL(fileURLWithPath: sourcePath)
        guard fileManager.fileExists(atPath: sourcePath) else { return nil }

        let archiveRoot = URL(fileURLWithPath: albumRoot, isDirectory: true)
            .appendingPathComponent("old", isDirectory: true)

        try fileManager.createDirectory(at: archiveRoot, withIntermediateDirectories: true, attributes: nil)

        let timestamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let stem = sourceURL.deletingPathExtension().lastPathComponent
        let ext = sourceURL.pathExtension
        let archivedName = "\(stem)-\(timestamp).\(ext)"
        let destinationURL = archiveRoot.appendingPathComponent(archivedName)

        do {
            try fileManager.moveItem(at: sourceURL, to: destinationURL)
            return destinationURL.path
        } catch {
            return nil
        }
    }

    private func album(from row: SQLiteRow) -> Album? {
        guard
            let id = row["id"]?.intValue,
            let name = row["name"]?.textValue,
            let path = row["path"]?.textValue,
            let autoMove = row["auto_move_old"]?.intValue,
            let createdAt = row["created_at"]?.doubleValue,
            let updatedAt = row["updated_at"]?.doubleValue
        else {
            return nil
        }

        return Album(
            id: id,
            name: name,
            path: path,
            autoMoveOld: autoMove == 1,
            createdAt: Date(timeIntervalSince1970: createdAt),
            updatedAt: Date(timeIntervalSince1970: updatedAt)
        )
    }

    private func song(from row: SQLiteRow) -> Song? {
        guard
            let id = row["id"]?.intValue,
            let albumID = row["album_id"]?.intValue,
            let title = row["title"]?.textValue,
            let normalizedTitle = row["normalized_title"]?.textValue,
            let createdAt = row["created_at"]?.doubleValue,
            let updatedAt = row["updated_at"]?.doubleValue
        else {
            return nil
        }

        return Song(
            id: id,
            albumID: albumID,
            title: title,
            normalizedTitle: normalizedTitle,
            createdAt: Date(timeIntervalSince1970: createdAt),
            updatedAt: Date(timeIntervalSince1970: updatedAt)
        )
    }

    private func version(from row: SQLiteRow) -> SongVersion? {
        guard
            let id = row["id"]?.intValue,
            let songID = row["song_id"]?.intValue,
            let filePath = row["file_path"]?.textValue,
            let fileName = row["file_name"]?.textValue,
            let fileStem = row["file_stem"]?.textValue,
            let fileExt = row["file_ext"]?.textValue,
            let fileSize = row["file_size"]?.intValue,
            let modifiedAt = row["modified_at"]?.doubleValue,
            let createdAt = row["created_at"]?.doubleValue,
            let isActive = row["is_active"]?.intValue
        else {
            return nil
        }

        return SongVersion(
            id: id,
            songID: songID,
            filePath: filePath,
            fileName: fileName,
            fileStem: fileStem,
            fileExtension: fileExt,
            fileSize: fileSize,
            modifiedAt: Date(timeIntervalSince1970: modifiedAt),
            createdAt: Date(timeIntervalSince1970: createdAt),
            isActive: isActive == 1,
            archivedPath: row["archived_path"]?.textValue
        )
    }

    private func sqlDate(_ value: SQLiteValue) -> Date? {
        switch value {
        case .double(let seconds):
            return Date(timeIntervalSince1970: seconds)
        case .int(let seconds):
            return Date(timeIntervalSince1970: TimeInterval(seconds))
        default:
            return nil
        }
    }
}
