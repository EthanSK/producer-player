import Foundation

enum MatchOutcome {
    case matched(MatchCandidate)
    case uncertain([MatchCandidate])
    case newSong
}

struct MatchingEngine {
    var fuzzyThreshold: Double = 0.76

    func match(
        fileStem rawStem: String,
        songs: [Song],
        regexRules: [RegexRule],
        feedback: [MatchFeedback]
    ) -> MatchOutcome {
        guard !songs.isEmpty else { return .newSong }

        let normalizedStem = rawStem.normalizedSongKey()
        guard !normalizedStem.isEmpty else { return .newSong }

        // 0) Trained feedback (highest priority)
        if let trained = feedback.first(where: { $0.fileStem == normalizedStem }),
           let trainedSong = songs.first(where: { $0.id == trained.songID }) {
            return .matched(MatchCandidate(song: trainedSong, score: max(trained.confidence, 0.98), reason: "trained matcher"))
        }

        // 1) Exact normalized filename match
        if let exact = songs.first(where: { $0.normalizedTitle == normalizedStem }) {
            return .matched(MatchCandidate(song: exact, score: 1.0, reason: "exact filename (extension ignored)"))
        }

        // 2) Regex transforms
        for rule in regexRules where rule.enabled {
            guard let regex = try? NSRegularExpression(pattern: rule.pattern, options: [.caseInsensitive]) else {
                continue
            }

            let range = NSRange(location: 0, length: rawStem.utf16.count)
            if regex.firstMatch(in: rawStem, options: [], range: range) != nil {
                let transformed = regex.stringByReplacingMatches(
                    in: rawStem,
                    options: [],
                    range: range,
                    withTemplate: rule.replacement
                ).normalizedSongKey()

                if let exactRegex = songs.first(where: { $0.normalizedTitle == transformed }) {
                    return .matched(MatchCandidate(song: exactRegex, score: 0.95, reason: "regex rule #\(rule.id)"))
                }

                let regexCandidates = songs
                    .map { song in
                        MatchCandidate(
                            song: song,
                            score: transformed.fuzzySimilarity(to: song.normalizedTitle),
                            reason: "regex + fuzzy"
                        )
                    }
                    .sorted { $0.score > $1.score }

                if let top = regexCandidates.first, top.score >= 0.88 {
                    return .matched(top)
                }
            }
        }

        // 3) Fuzzy fall-through
        let candidates = songs
            .map { song in
                MatchCandidate(
                    song: song,
                    score: normalizedStem.fuzzySimilarity(to: song.normalizedTitle),
                    reason: "fuzzy (levenshtein)"
                )
            }
            .sorted { $0.score > $1.score }

        guard let top = candidates.first else { return .newSong }
        if top.score < fuzzyThreshold {
            return .newSong
        }

        let secondScore = candidates.dropFirst().first?.score ?? 0
        let confidenceGap = top.score - secondScore

        // uncertain if top is near threshold or too close to second choice
        if top.score < 0.88 || confidenceGap < 0.08 {
            return .uncertain(Array(candidates.prefix(4)))
        }

        return .matched(top)
    }
}
