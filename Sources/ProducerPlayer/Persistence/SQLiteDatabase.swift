import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum SQLiteError: Error, LocalizedError {
    case openDatabase(String)
    case prepare(String)
    case bind(String)
    case step(String)

    var errorDescription: String? {
        switch self {
        case .openDatabase(let message):
            return "Failed to open database: \(message)"
        case .prepare(let message):
            return "Failed to prepare statement: \(message)"
        case .bind(let message):
            return "Failed to bind statement: \(message)"
        case .step(let message):
            return "Failed to execute statement: \(message)"
        }
    }
}

enum SQLiteValue: Hashable {
    case int(Int64)
    case double(Double)
    case text(String)
    case null

    var intValue: Int64? {
        if case .int(let value) = self { return value }
        return nil
    }

    var doubleValue: Double? {
        if case .double(let value) = self { return value }
        return nil
    }

    var textValue: String? {
        if case .text(let value) = self { return value }
        return nil
    }
}

typealias SQLiteRow = [String: SQLiteValue]

final class SQLiteDatabase {
    private var db: OpaquePointer?

    init(path: String) throws {
        if sqlite3_open(path, &db) != SQLITE_OK {
            throw SQLiteError.openDatabase(lastErrorMessage())
        }
        try execute("PRAGMA journal_mode=WAL;")
        try execute("PRAGMA synchronous=NORMAL;")
        try execute("PRAGMA foreign_keys=ON;")
    }

    deinit {
        sqlite3_close(db)
    }

    func execute(_ sql: String, bindings: [SQLiteValue] = []) throws {
        let statement = try prepareStatement(sql)
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement)

        if sqlite3_step(statement) != SQLITE_DONE {
            throw SQLiteError.step(lastErrorMessage())
        }
    }

    func query(_ sql: String, bindings: [SQLiteValue] = []) throws -> [SQLiteRow] {
        let statement = try prepareStatement(sql)
        defer { sqlite3_finalize(statement) }
        try bind(bindings, to: statement)

        var rows: [SQLiteRow] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_ROW {
                rows.append(readRow(statement))
            } else if step == SQLITE_DONE {
                break
            } else {
                throw SQLiteError.step(lastErrorMessage())
            }
        }
        return rows
    }

    func lastInsertedRowID() -> Int64 {
        sqlite3_last_insert_rowid(db)
    }

    private func prepareStatement(_ sql: String) throws -> OpaquePointer? {
        var statement: OpaquePointer?
        if sqlite3_prepare_v2(db, sql, -1, &statement, nil) != SQLITE_OK {
            throw SQLiteError.prepare(lastErrorMessage())
        }
        return statement
    }

    private func bind(_ bindings: [SQLiteValue], to statement: OpaquePointer?) throws {
        for (index, value) in bindings.enumerated() {
            let position = Int32(index + 1)
            let result: Int32

            switch value {
            case .int(let integer):
                result = sqlite3_bind_int64(statement, position, integer)
            case .double(let double):
                result = sqlite3_bind_double(statement, position, double)
            case .text(let string):
                result = sqlite3_bind_text(statement, position, string, -1, SQLITE_TRANSIENT)
            case .null:
                result = sqlite3_bind_null(statement, position)
            }

            if result != SQLITE_OK {
                throw SQLiteError.bind(lastErrorMessage())
            }
        }
    }

    private func readRow(_ statement: OpaquePointer?) -> SQLiteRow {
        var row: SQLiteRow = [:]
        let count = sqlite3_column_count(statement)

        for index in 0..<count {
            let name = String(cString: sqlite3_column_name(statement, index))
            let type = sqlite3_column_type(statement, index)

            switch type {
            case SQLITE_INTEGER:
                row[name] = .int(sqlite3_column_int64(statement, index))
            case SQLITE_FLOAT:
                row[name] = .double(sqlite3_column_double(statement, index))
            case SQLITE_TEXT:
                row[name] = .text(String(cString: sqlite3_column_text(statement, index)))
            default:
                row[name] = .null
            }
        }
        return row
    }

    private func lastErrorMessage() -> String {
        guard let db, let cString = sqlite3_errmsg(db) else {
            return "Unknown SQLite error"
        }
        return String(cString: cString)
    }
}
