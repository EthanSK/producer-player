function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function clampToRange(value: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) {
    return min;
  }

  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function readSeriesValue(series: ArrayLike<number>, index: number): number | null {
  if (index < 0 || index >= series.length) {
    return null;
  }

  const value = series[index];
  if (!isFiniteNumber(value)) {
    return null;
  }

  return value;
}

export function sampleSeriesAtRatio(series: ArrayLike<number>, ratio: number): number | null {
  if (series.length === 0 || !isFiniteNumber(ratio)) {
    return null;
  }

  if (series.length === 1) {
    return readSeriesValue(series, 0);
  }

  const clampedRatio = clampToRange(ratio, 0, 1);
  const floatIndex = clampedRatio * (series.length - 1);
  const lowIndex = Math.floor(floatIndex);
  const highIndex = Math.min(Math.ceil(floatIndex), series.length - 1);

  const lowValue = readSeriesValue(series, lowIndex);
  const highValue = readSeriesValue(series, highIndex);

  if (lowValue === null && highValue === null) {
    return null;
  }

  if (lowValue === null) {
    return highValue;
  }

  if (highValue === null) {
    return lowValue;
  }

  if (lowIndex === highIndex) {
    return lowValue;
  }

  const frac = floatIndex - lowIndex;
  return lowValue * (1 - frac) + highValue * frac;
}

export function sampleSeriesAtTime(
  series: ArrayLike<number>,
  frameDurationSeconds: number,
  timeSeconds: number
): number | null {
  if (series.length === 0 || !isFiniteNumber(frameDurationSeconds) || frameDurationSeconds <= 0) {
    return null;
  }

  if (series.length === 1) {
    return readSeriesValue(series, 0);
  }

  const maxTimeSeconds = frameDurationSeconds * (series.length - 1);
  if (maxTimeSeconds <= 0) {
    return readSeriesValue(series, 0);
  }

  const clampedTimeSeconds = clampToRange(timeSeconds, 0, maxTimeSeconds);
  const ratio = clampedTimeSeconds / maxTimeSeconds;
  return sampleSeriesAtRatio(series, ratio);
}

export function sampleSpectrumDbAtFrequency(
  spectrumDbValues: ArrayLike<number>,
  frequencyHz: number,
  fftSize: number,
  sampleRate: number,
  fallbackDb: number
): number {
  if (
    spectrumDbValues.length === 0 ||
    !isFiniteNumber(frequencyHz) ||
    !isFiniteNumber(fftSize) ||
    fftSize <= 0 ||
    !isFiniteNumber(sampleRate) ||
    sampleRate <= 0
  ) {
    return fallbackDb;
  }

  const nyquistHz = sampleRate / 2;
  if (!isFiniteNumber(nyquistHz) || nyquistHz <= 0) {
    return fallbackDb;
  }

  const clampedFrequencyHz = clampToRange(frequencyHz, 0, nyquistHz);
  const maxBinIndex = spectrumDbValues.length - 1;

  if (maxBinIndex <= 0) {
    return readSeriesValue(spectrumDbValues, 0) ?? fallbackDb;
  }

  const binIndexFloat = (clampedFrequencyHz * fftSize) / sampleRate;
  const clampedBinIndex = clampToRange(binIndexFloat, 0, maxBinIndex);
  const ratio = clampedBinIndex / maxBinIndex;

  return sampleSeriesAtRatio(spectrumDbValues, ratio) ?? fallbackDb;
}
