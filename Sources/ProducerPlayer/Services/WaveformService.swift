import Foundation
import AVFoundation
import SwiftUI

actor WaveformService {
    private var cache: [String: [CGFloat]] = [:]

    func invalidate(path: String) {
        cache[path] = nil
    }

    func samples(for url: URL, bucketCount: Int = 120) async -> [CGFloat] {
        if let cached = cache[url.path] {
            return cached
        }

        do {
            let generated = try buildSamples(url: url, bucketCount: bucketCount)
            cache[url.path] = generated
            return generated
        } catch {
            // fallback deterministic placeholder
            let fallback = (0..<bucketCount).map { i in
                let x = Double(i) / Double(max(bucketCount - 1, 1))
                return CGFloat(0.15 + 0.5 * abs(sin(x * .pi * 8.0)))
            }
            cache[url.path] = fallback
            return fallback
        }
    }

    private func buildSamples(url: URL, bucketCount: Int) throws -> [CGFloat] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat

        // Fast path for float PCM decode.
        guard let channelData = try readFloatChannelData(file: file, format: format) else {
            throw NSError(domain: "Waveform", code: -1)
        }

        let frameCount = channelData.count
        guard frameCount > 0 else { return [] }

        let bucketSize = max(frameCount / bucketCount, 1)
        var buckets: [CGFloat] = []
        buckets.reserveCapacity(bucketCount)

        for bucketIndex in 0..<bucketCount {
            let start = bucketIndex * bucketSize
            if start >= frameCount {
                buckets.append(0.0)
                continue
            }
            let end = min(start + bucketSize, frameCount)
            var peak: Float = 0
            if start < end {
                for sample in channelData[start..<end] {
                    peak = max(peak, abs(sample))
                }
            }
            buckets.append(CGFloat(peak))
        }

        let maxValue = buckets.max() ?? 1.0
        if maxValue > 0 {
            return buckets.map { max(0.02, $0 / maxValue) }
        }
        return buckets
    }

    private func readFloatChannelData(file: AVAudioFile, format: AVAudioFormat) throws -> [Float]? {
        let totalFrames = Int(file.length)
        guard totalFrames > 0 else { return [] }

        let maxFrames = min(totalFrames, 480_000) // cap for responsiveness
        let readChunk = AVAudioFrameCount(min(8192, maxFrames))
        var output: [Float] = []
        output.reserveCapacity(maxFrames)

        file.framePosition = 0

        while output.count < maxFrames {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: readChunk) else {
                break
            }
            try file.read(into: buffer, frameCount: readChunk)
            let frameLength = Int(buffer.frameLength)
            if frameLength == 0 { break }

            guard let channels = buffer.floatChannelData else {
                return nil
            }

            let channelCount = Int(format.channelCount)
            let framesToTake = min(frameLength, maxFrames - output.count)

            for frameIndex in 0..<framesToTake {
                var mixed: Float = 0
                for channel in 0..<channelCount {
                    mixed += channels[channel][frameIndex]
                }
                output.append(mixed / Float(max(channelCount, 1)))
            }
        }

        return output
    }
}
