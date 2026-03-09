import Foundation

extension String {
    static let versionNoiseTokens: Set<String> = [
        "v", "ver", "version", "master", "final", "mix", "mixdown", "bounce", "render", "export", "new"
    ]

    func normalizedSongKey() -> String {
        let lowered = self
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")

        let cleaned = lowered.unicodeScalars
            .map { CharacterSet.alphanumerics.contains($0) || $0 == " " ? Character($0) : " " }

        let tokens = String(cleaned)
            .split(separator: " ")
            .map(String.init)
            .filter { token in
                if Self.versionNoiseTokens.contains(token) { return false }
                if token.range(of: "^v?[0-9]+$", options: .regularExpression) != nil { return false }
                return true
            }

        return tokens.joined(separator: " ")
    }

    func fuzzySimilarity(to other: String) -> Double {
        let lhs = Array(self)
        let rhs = Array(other)
        if lhs.isEmpty && rhs.isEmpty { return 1.0 }
        if lhs.isEmpty || rhs.isEmpty { return 0.0 }

        let distance = Self.levenshtein(lhs, rhs)
        let maxLen = max(lhs.count, rhs.count)
        return 1.0 - (Double(distance) / Double(maxLen))
    }

    private static func levenshtein(_ lhs: [Character], _ rhs: [Character]) -> Int {
        var previous = Array(0...rhs.count)
        var current = Array(repeating: 0, count: rhs.count + 1)

        for (i, lChar) in lhs.enumerated() {
            current[0] = i + 1
            for (j, rChar) in rhs.enumerated() {
                let cost = lChar == rChar ? 0 : 1
                current[j + 1] = Swift.min(
                    current[j] + 1,
                    previous[j + 1] + 1,
                    previous[j] + cost
                )
            }
            swap(&previous, &current)
        }
        return previous[rhs.count]
    }
}

extension URL {
    var audioFileStem: String {
        deletingPathExtension().lastPathComponent
    }
}
