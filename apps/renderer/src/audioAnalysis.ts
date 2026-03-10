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
}

const MIN_DECIBELS = -96;
const LOUDNESS_WINDOW_SECONDS = 3;
const LOUDNESS_FRAME_SECONDS = 0.25;
const LOW_BAND_CUTOFF_HZ = 250;
const HIGH_BAND_CUTOFF_HZ = 4_000;

let sharedAudioContext: AudioContext | null = null;

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

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext();
  }

  return sharedAudioContext;
}

async function decodeAudioBuffer(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
  ensureNotAborted(signal);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch analysis source (${response.status}).`);
  }

  const bytes = await response.arrayBuffer();
  ensureNotAborted(signal);

  const context = getAudioContext();
  return context.decodeAudioData(bytes.slice(0));
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

export async function analyzeTrackFromUrl(
  url: string,
  signal?: AbortSignal
): Promise<TrackAnalysisResult> {
  const buffer = await decodeAudioBuffer(url, signal);
  ensureNotAborted(signal);

  const mono = createMonoData(buffer);
  const { peakDbfs, integratedLufsEstimate } = calculatePeakAndIntegrated(mono);
  const { frameDurationSeconds, frameLoudnessDbfs } = calculateFrameLoudnessDbfs(
    mono,
    buffer.sampleRate
  );
  const tonalBalance = calculateTonalBalance(mono, buffer.sampleRate);

  return {
    peakDbfs,
    integratedLufsEstimate,
    frameLoudnessDbfs,
    frameDurationSeconds,
    durationSeconds: buffer.duration,
    tonalBalance,
  };
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
