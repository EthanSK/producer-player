import {
  AnalysisQueue,
  ANALYSIS_PRIORITY_BACKGROUND,
  ANALYSIS_PRIORITY_USER_SELECTED,
  type AnalysisPriority,
} from './audioAnalysisQueue';

export interface TonalBalanceSnapshot {
  low: number;
  mid: number;
  high: number;
}

export interface TrackAnalysisResult {
  peakDbfs: number;
  integratedLufsEstimate: number;
  frameLoudnessDbfs: number[];
  frameDurationSeconds: number;
  durationSeconds: number;
  tonalBalance: TonalBalanceSnapshot;
  rmsDbfs: number;
  crestFactorDb: number;
  dcOffset: number;
  clipCount: number;
  waveformPeaks: Float32Array;
}

const MIN_DECIBELS = -96;
const LOUDNESS_WINDOW_SECONDS = 3;
const LOUDNESS_FRAME_SECONDS = 0.25;
const LOW_BAND_CUTOFF_HZ = 250;
const HIGH_BAND_CUTOFF_HZ = 4_000;

// Full-track decode can be very memory-hungry for long WAV/AIFF files.
// We keep concurrency=1 here so we never have two huge decoded AudioBuffers
// alive at the same moment. The priority queue lets a user-selected track
// jump ahead of pending background-preload jobs (item #10, v3.110). Re-export
// the queue priorities so callers don't need a second import.
const previewAnalysisQueue = new AnalysisQueue({
  concurrency: 1,
  label: 'preview-analysis',
});

export {
  ANALYSIS_PRIORITY_BACKGROUND,
  ANALYSIS_PRIORITY_USER_SELECTED,
} from './audioAnalysisQueue';
export type { AnalysisPriority } from './audioAnalysisQueue';

function createAbortError(): Error {
  return new DOMException('The analysis request was aborted.', 'AbortError');
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function amplitudeToDbfs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return MIN_DECIBELS;
  }

  return Math.max(MIN_DECIBELS, 20 * Math.log10(value));
}

// Internal: enqueue a preview-analysis task with the shared priority queue.
function runPreviewAnalysis<T>(
  task: () => Promise<T>,
  options: { priority?: AnalysisPriority; key?: string } = {}
): Promise<T> {
  return previewAnalysisQueue.enqueue(task, options);
}

/**
 * Reprioritize a queued preview analysis (item #10). Useful when the user
 * clicks a track that was already enqueued at background priority — we want
 * it to jump ahead of the rest of the preload queue without re-decoding.
 *
 * No-op when the task is already running, has settled, or was never enqueued.
 */
export function promotePreviewAnalysis(
  key: string,
  priority: AnalysisPriority = ANALYSIS_PRIORITY_USER_SELECTED
): void {
  previewAnalysisQueue.promote(key, priority);
}

function createMonoData(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  const channelCount = buffer.numberOfChannels;

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
      mono[sampleIndex] += channel[sampleIndex] / channelCount;
    }
  }

  return mono;
}

function calculateFrameLoudnessDbfs(
  mono: Float32Array,
  sampleRate: number
): { frameDurationSeconds: number; frameLoudnessDbfs: number[] } {
  const frameSize = Math.max(1, Math.round(sampleRate * LOUDNESS_FRAME_SECONDS));
  const frames: number[] = [];

  for (let start = 0; start < mono.length; start += frameSize) {
    let sumSquares = 0;
    const end = Math.min(mono.length, start + frameSize);

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = mono[sampleIndex];
      sumSquares += sample * sample;
    }

    const frameLength = end - start;
    const rms = frameLength > 0 ? Math.sqrt(sumSquares / frameLength) : 0;
    frames.push(amplitudeToDbfs(rms));
  }

  return {
    frameDurationSeconds: frameSize / sampleRate,
    frameLoudnessDbfs: frames,
  };
}

function calculatePeakAndIntegrated(mono: Float32Array): {
  peakDbfs: number;
  integratedLufsEstimate: number;
} {
  let peak = 0;
  let sumSquares = 0;

  for (let sampleIndex = 0; sampleIndex < mono.length; sampleIndex += 1) {
    const sample = mono[sampleIndex];
    const absolute = Math.abs(sample);
    if (absolute > peak) {
      peak = absolute;
    }
    sumSquares += sample * sample;
  }

  const rms = mono.length > 0 ? Math.sqrt(sumSquares / mono.length) : 0;

  return {
    peakDbfs: amplitudeToDbfs(peak),
    integratedLufsEstimate: amplitudeToDbfs(rms),
  };
}

function lowPassAlpha(cutoffHz: number, sampleRate: number): number {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  return dt / (rc + dt);
}

function highPassAlpha(cutoffHz: number, sampleRate: number): number {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  return rc / (rc + dt);
}

function calculateTonalBalance(mono: Float32Array, sampleRate: number): TonalBalanceSnapshot {
  const lowAlpha = lowPassAlpha(LOW_BAND_CUTOFF_HZ, sampleRate);
  const highAlpha = highPassAlpha(HIGH_BAND_CUTOFF_HZ, sampleRate);
  const midHighPassAlpha = highPassAlpha(LOW_BAND_CUTOFF_HZ, sampleRate);
  const midLowPassAlpha = lowPassAlpha(HIGH_BAND_CUTOFF_HZ, sampleRate);

  let lowState = 0;
  let highState = 0;
  let previousHighInput = 0;
  let midHighPassState = 0;
  let previousMidHighPassInput = 0;
  let midLowPassState = 0;

  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;

  for (let sampleIndex = 0; sampleIndex < mono.length; sampleIndex += 1) {
    const sample = mono[sampleIndex];

    lowState += lowAlpha * (sample - lowState);
    lowEnergy += lowState * lowState;

    highState = highAlpha * (highState + sample - previousHighInput);
    previousHighInput = sample;
    highEnergy += highState * highState;

    midHighPassState =
      midHighPassAlpha * (midHighPassState + sample - previousMidHighPassInput);
    previousMidHighPassInput = sample;
    midLowPassState += midLowPassAlpha * (midHighPassState - midLowPassState);
    midEnergy += midLowPassState * midLowPassState;
  }

  const totalEnergy = lowEnergy + midEnergy + highEnergy;
  if (totalEnergy <= 0) {
    return { low: 0, mid: 0, high: 0 };
  }

  return {
    low: clampUnit(lowEnergy / totalEnergy),
    mid: clampUnit(midEnergy / totalEnergy),
    high: clampUnit(highEnergy / totalEnergy),
  };
}

function calculateRmsDbfs(mono: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < mono.length; i++) {
    sumSquares += mono[i] * mono[i];
  }
  const rms = mono.length > 0 ? Math.sqrt(sumSquares / mono.length) : 0;
  return amplitudeToDbfs(rms);
}

function calculateDcOffset(mono: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < mono.length; i++) {
    sum += mono[i];
  }
  return mono.length > 0 ? sum / mono.length : 0;
}

function countClips(mono: Float32Array): number {
  let count = 0;
  for (let i = 0; i < mono.length; i++) {
    if (mono[i] >= 1.0 || mono[i] <= -1.0) {
      count++;
    }
  }
  return count;
}

const WAVEFORM_BUCKET_COUNT = 800;

function computeWaveformPeaks(mono: Float32Array, bucketCount: number): Float32Array {
  const peaks = new Float32Array(bucketCount);
  const samplesPerBucket = mono.length / bucketCount;

  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(Math.floor((b + 1) * samplesPerBucket), mono.length);
    let maxAbs = 0;

    for (let i = start; i < end; i++) {
      const abs = Math.abs(mono[i]);
      if (abs > maxAbs) maxAbs = abs;
    }

    peaks[b] = maxAbs;
  }

  return peaks;
}

export async function analyzeTrackFromUrl(
  url: string,
  signal?: AbortSignal,
  options: { priority?: AnalysisPriority; key?: string } = {}
): Promise<TrackAnalysisResult> {
  return runPreviewAnalysis(async () => {
    ensureNotAborted(signal);

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch analysis source (${response.status}).`);
    }

    const bytes = await response.arrayBuffer();
    ensureNotAborted(signal);

    const context = new AudioContext();

    try {
      // Pass the fetched buffer directly so we do not allocate a second
      // full-size copy of long audio files right before decode.
      const buffer = await context.decodeAudioData(bytes);
      ensureNotAborted(signal);

      const mono = createMonoData(buffer);
      const { peakDbfs, integratedLufsEstimate } = calculatePeakAndIntegrated(mono);
      const { frameDurationSeconds, frameLoudnessDbfs } = calculateFrameLoudnessDbfs(
        mono,
        buffer.sampleRate
      );
      const tonalBalance = calculateTonalBalance(mono, buffer.sampleRate);
      const rmsDbfs = calculateRmsDbfs(mono);
      const crestFactorDb = peakDbfs - rmsDbfs;
      const dcOffset = calculateDcOffset(mono);
      const clipCount = countClips(mono);
      const waveformPeaks = computeWaveformPeaks(mono, WAVEFORM_BUCKET_COUNT);

      return {
        peakDbfs,
        integratedLufsEstimate,
        frameLoudnessDbfs,
        frameDurationSeconds,
        durationSeconds: buffer.duration,
        tonalBalance,
        rmsDbfs,
        crestFactorDb,
        dcOffset,
        clipCount,
        waveformPeaks,
      };
    } finally {
      void context.close().catch(() => undefined);
    }
  }, options);
}

export function estimateShortTermLufs(
  analysis: TrackAnalysisResult,
  currentTimeSeconds: number
): number {
  const frameCount = analysis.frameLoudnessDbfs.length;
  if (frameCount === 0 || analysis.frameDurationSeconds <= 0) {
    return MIN_DECIBELS;
  }

  const safeTimeSeconds = Number.isFinite(currentTimeSeconds) && currentTimeSeconds >= 0
    ? Math.min(currentTimeSeconds, analysis.durationSeconds)
    : 0;

  const endFrameExclusive = Math.max(
    1,
    Math.min(frameCount, Math.ceil(safeTimeSeconds / analysis.frameDurationSeconds) || 1)
  );
  const windowFrameCount = Math.max(
    1,
    Math.round(LOUDNESS_WINDOW_SECONDS / analysis.frameDurationSeconds)
  );
  const startFrame = Math.max(0, endFrameExclusive - windowFrameCount);

  let linearPower = 0;
  let count = 0;
  for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex += 1) {
    const amplitude = 10 ** (analysis.frameLoudnessDbfs[frameIndex] / 20);
    linearPower += amplitude * amplitude;
    count += 1;
  }

  const rms = count > 0 ? Math.sqrt(linearPower / count) : 0;
  return amplitudeToDbfs(rms);
}
