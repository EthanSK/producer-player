import AVFoundation
import AudioToolbox
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

private struct Options {
  var bundleID = "com.ethansk.producerplayer"
  var durationSeconds = 8.0
  var countdownSeconds = 0
  var outputURL: URL?
  var listApplications = false
  var preflightOnly = false
}

private enum CaptureError: LocalizedError {
  case invalidArguments(String)
  case permissionMissing
  case applicationNotFound(String)
  case noDisplay
  case noAudioSamples
  case writer(String)

  var errorDescription: String? {
    switch self {
    case .invalidArguments(let message): return message
    case .permissionMissing:
      return "Screen & System Audio Recording permission is not available for this terminal host."
    case .applicationNotFound(let bundleID):
      return "No running application matched bundle id/prefix \(bundleID)."
    case .noDisplay: return "ScreenCaptureKit reported no displays."
    case .noAudioSamples: return "The capture completed without receiving any application-audio samples."
    case .writer(let message): return message
    }
  }
}

private func defaultOutputURL() -> URL {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.dateFormat = "yyyyMMdd-HHmmss"
  let name = "producer-player-output-\(formatter.string(from: Date())).caf"
  return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    .appendingPathComponent("diagnostics/audio-output", isDirectory: true)
    .appendingPathComponent(name)
}

private func parseOptions() throws -> Options {
  var options = Options()
  var arguments = Array(CommandLine.arguments.dropFirst())

  func takeValue(after flag: String) throws -> String {
    guard !arguments.isEmpty else {
      throw CaptureError.invalidArguments("Missing value after \(flag).")
    }
    return arguments.removeFirst()
  }

  while !arguments.isEmpty {
    let argument = arguments.removeFirst()
    switch argument {
    case "--bundle-id":
      options.bundleID = try takeValue(after: argument)
    case "--duration":
      let raw = try takeValue(after: argument)
      guard let value = Double(raw), value > 0, value <= 300 else {
        throw CaptureError.invalidArguments("--duration must be between 0 and 300 seconds.")
      }
      options.durationSeconds = value
    case "--countdown":
      let raw = try takeValue(after: argument)
      guard let value = Int(raw), value >= 0, value <= 60 else {
        throw CaptureError.invalidArguments("--countdown must be between 0 and 60 seconds.")
      }
      options.countdownSeconds = value
    case "--output":
      let raw = try takeValue(after: argument)
      options.outputURL = URL(fileURLWithPath: raw).standardizedFileURL
    case "--list-apps":
      options.listApplications = true
    case "--preflight":
      options.preflightOnly = true
    case "--help", "-h":
      print("""
      Capture one macOS application's real system-audio output without recording a microphone.

        --bundle-id ID   Bundle id or prefix (default: com.ethansk.producerplayer)
        --duration N     Capture duration in seconds (default: 8)
        --countdown N    Delay before capture begins (default: 0)
        --output PATH    PCM CAF output path
        --list-apps      List ScreenCaptureKit-visible running applications
        --preflight      Print permission state without requesting permission
      """)
      exit(EXIT_SUCCESS)
    default:
      throw CaptureError.invalidArguments("Unknown argument: \(argument). Use --help for usage.")
    }
  }

  return options
}

private final class ApplicationAudioWriter: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
  let sampleQueue = DispatchQueue(label: "com.ethansk.producerplayer.output-capture.audio", qos: .userInitiated)

  private let outputURL: URL
  private var assetWriter: AVAssetWriter?
  private var writerInput: AVAssetWriterInput?
  private var firstPresentationTime: CMTime?
  private var lastPresentationTime: CMTime?
  private var receivedBuffers = 0
  private var droppedBuffers = 0
  private var terminalError: Error?

  init(outputURL: URL) {
    self.outputURL = outputURL
  }

  func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of outputType: SCStreamOutputType
  ) {
    guard outputType == .audio, sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else {
      return
    }

    do {
      if assetWriter == nil {
        try startWriter(with: sampleBuffer)
      }
      guard let assetWriter, let writerInput else { return }
      guard assetWriter.status == .writing else {
        throw CaptureError.writer(assetWriter.error?.localizedDescription ?? "Audio writer is not writable.")
      }

      if writerInput.isReadyForMoreMediaData {
        if !writerInput.append(sampleBuffer) {
          throw CaptureError.writer(assetWriter.error?.localizedDescription ?? "Could not append an audio buffer.")
        }
        receivedBuffers += 1
        lastPresentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
      } else {
        droppedBuffers += 1
      }
    } catch {
      terminalError = terminalError ?? error
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: any Error) {
    sampleQueue.async { [weak self] in
      self?.terminalError = self?.terminalError ?? error
    }
  }

  private func startWriter(with sampleBuffer: CMSampleBuffer) throws {
    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else {
      throw CaptureError.writer("The first audio sample had no format description.")
    }

    try FileManager.default.createDirectory(
      at: outputURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try? FileManager.default.removeItem(at: outputURL)

    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .caf)
    let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee
    let sampleRate = asbd?.mSampleRate ?? 48_000
    let channelCount = Int(asbd?.mChannelsPerFrame ?? 2)
    let outputSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channelCount,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let input = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: outputSettings,
      sourceFormatHint: formatDescription
    )
    input.expectsMediaDataInRealTime = true
    guard writer.canAdd(input) else {
      throw CaptureError.writer("AVAssetWriter cannot accept ScreenCaptureKit's audio format.")
    }
    writer.add(input)
    guard writer.startWriting() else {
      throw CaptureError.writer(writer.error?.localizedDescription ?? "AVAssetWriter could not start.")
    }

    let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    writer.startSession(atSourceTime: presentationTime)
    assetWriter = writer
    writerInput = input
    firstPresentationTime = presentationTime
  }

  func finish() async throws -> (buffers: Int, dropped: Int, durationSeconds: Double) {
    try await withCheckedThrowingContinuation { continuation in
      sampleQueue.async { [self] in
        if let terminalError {
          assetWriter?.cancelWriting()
          continuation.resume(throwing: terminalError)
          return
        }
        guard receivedBuffers > 0, let assetWriter, let writerInput else {
          continuation.resume(throwing: CaptureError.noAudioSamples)
          return
        }

        writerInput.markAsFinished()
        if let lastPresentationTime {
          assetWriter.endSession(atSourceTime: lastPresentationTime)
        }
        assetWriter.finishWriting { [self] in
          if assetWriter.status == .completed {
            let duration = if let firstPresentationTime, let lastPresentationTime {
              max(0.0, CMTimeGetSeconds(lastPresentationTime - firstPresentationTime))
            } else {
              0.0
            }
            continuation.resume(returning: (receivedBuffers, droppedBuffers, duration))
          } else {
            continuation.resume(
              throwing: CaptureError.writer(
                assetWriter.error?.localizedDescription ?? "AVAssetWriter did not finish successfully."
              )
            )
          }
        }
      }
    }
  }
}

@main
private struct CaptureAppAudio {
  static func main() async {
    do {
      let options = try parseOptions()
      let permissionAvailable = CGPreflightScreenCaptureAccess()
      if options.preflightOnly {
        print(permissionAvailable ? "authorized" : "not-authorized")
        exit(permissionAvailable ? EXIT_SUCCESS : EXIT_FAILURE)
      }
      guard permissionAvailable else {
        throw CaptureError.permissionMissing
      }

      let content = try await SCShareableContent.excludingDesktopWindows(
        false,
        onScreenWindowsOnly: false
      )
      if options.listApplications {
        for application in content.applications.sorted(by: {
          ($0.bundleIdentifier, $0.applicationName, $0.processID) <
            ($1.bundleIdentifier, $1.applicationName, $1.processID)
        }) {
          print("\(application.processID)\t\(application.bundleIdentifier)\t\(application.applicationName)")
        }
        exit(EXIT_SUCCESS)
      }

      let matchingApplications = content.applications.filter { application in
        application.bundleIdentifier == options.bundleID ||
          application.bundleIdentifier.hasPrefix(options.bundleID + ".")
      }
      guard !matchingApplications.isEmpty else {
        throw CaptureError.applicationNotFound(options.bundleID)
      }
      guard let display = content.displays.first else {
        throw CaptureError.noDisplay
      }

      let outputURL = options.outputURL ?? defaultOutputURL()
      let writer = ApplicationAudioWriter(outputURL: outputURL)
      let filter = SCContentFilter(
        display: display,
        including: matchingApplications,
        exceptingWindows: []
      )
      let configuration = SCStreamConfiguration()
      configuration.capturesAudio = true
      configuration.excludesCurrentProcessAudio = true
      configuration.sampleRate = 48_000
      configuration.channelCount = 2
      configuration.width = 2
      configuration.height = 2
      configuration.minimumFrameInterval = CMTime(seconds: 1, preferredTimescale: 1)
      configuration.queueDepth = 3

      if options.countdownSeconds > 0 {
        for remaining in stride(from: options.countdownSeconds, through: 1, by: -1) {
          print("Capture starts in \(remaining)…")
          try await Task.sleep(for: .seconds(1))
        }
      }

      let stream = SCStream(filter: filter, configuration: configuration, delegate: writer)
      try stream.addStreamOutput(writer, type: .audio, sampleHandlerQueue: writer.sampleQueue)
      print("Recording \(options.durationSeconds)s of app-only audio to \(outputURL.path)")
      try await stream.startCapture()
      try await Task.sleep(for: .seconds(options.durationSeconds))
      try await stream.stopCapture()
      let result = try await writer.finish()
      print(
        "Captured \(result.buffers) audio buffers " +
          "(dropped \(result.dropped), media span \(String(format: "%.3f", result.durationSeconds))s)."
      )
      print(outputURL.path)
    } catch {
      FileHandle.standardError.write(Data("error: \(error.localizedDescription)\n".utf8))
      exit(EXIT_FAILURE)
    }
  }
}
