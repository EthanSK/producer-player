/**
 * v3.240 — Pure-function track analysis core.
 *
 * Holds every heavy CPU loop that used to run inline on the renderer's main
 * thread inside `analyzeTrackFromUrl` (audioAnalysis.ts). Now shared between:
 *
 *   - The Web Worker at `trackAnalysisWorker.ts`, which is the production
 *     hot path. The worker receives transferred ArrayBuffer channel data,
 *     wraps them in Float32Array views, and calls `runTrackAnalysisCore`.
 *
 *   - A main-thread fallback inside `trackAnalysisClient.ts`, used when the
 *     Worker constructor throws (e.g. an environment that doesn't support
 *     module workers) or when running inside the Vitest jsdom test runner.
 *
 * Keeping these in one module guarantees that the worker path and the
 * fallback path produce bit-identical numbers — there's exactly one
 * implementation of every loop.
 */

import type { TonalBalanceSnapshot, TrackAnalysisResult } from './audioAnalysis';

const MIN_DECIBELS = -96;
const LOUDNESS_FRAME_SECONDS = 0.25;
const LOW_BAND_CUTOFF_HZ = 250;
const HIGH_BAND_CUTOFF_HZ = 4_000;
const WAVEFORM_BUCKET_COUNT = 800;

export type TrackAnalysisWorkerRequest = {
  id: string;
  channels: ArrayBuffer[]; // each is a Float32Array.buffer for one channel
  sampleRate: number;
  durationSeconds: number;
  length: number; // samples per channel
};

export type TrackAnalysisWorkerSuccess = {
  id: string;
  ok: true;
  result: {
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
    waveformPeaks: ArrayBuffer; // Float32Array.buffer, transferred
  };
};

export type TrackAnalysisWorkerFailure = {
  id: string;
  ok: false;
  error: string;
};

export type TrackAnalysisWorkerResponse =
  | TrackAnalysisWorkerSuccess
  | TrackAnalysisWorkerFailure;

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

function createMonoData(channels: Float32Array[], length: number): Float32Array {
  const mono = new Float32Array(length);
  const channelCount = channels.length;
  if (channelCount === 0) {
    return mono;
  }
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = channels[channelIndex];
    const limit = Math.min(channel.length, length);
    for (let sampleIndex = 0; sampleIndex < limit; sampleIndex += 1) {
      mono[sampleIndex] += channel[sampleIndex] / channelCount;
    }
  }
  return mono;
}

function calculateFrameLoudnessDbfs(
  mono: Float32Array,
  sampleRate: number,
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

function calculateTonalBalance(
  mono: Float32Array,
  sampleRate: number,
): TonalBalanceSnapshot {
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

/**
 * Runs the full track analysis pipeline against the supplied per-channel PCM
 * data and returns a `TrackAnalysisResult` bit-identical to what the legacy
 * inline `analyzeTrackFromUrl` body produced. Pure synchronous function — no
 * I/O, no AudioContext, no globals. Used by both the worker hot path and the
 * main-thread fallback.
 */
export function runTrackAnalysisCore(
  channels: Float32Array[],
  sampleRate: number,
  durationSeconds: number,
  length: number,
): TrackAnalysisResult {
  const mono = createMonoData(channels, length);

  const { peakDbfs, integratedLufsEstimate } = calculatePeakAndIntegrated(mono);
  const { frameDurationSeconds, frameLoudnessDbfs } = calculateFrameLoudnessDbfs(
    mono,
    sampleRate,
  );
  const tonalBalance = calculateTonalBalance(mono, sampleRate);
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
    durationSeconds,
    tonalBalance,
    rmsDbfs,
    crestFactorDb,
    dcOffset,
    clipCount,
    waveformPeaks,
  };
}
