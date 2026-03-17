/**
 * Audio Engine — manages AnalyserNode for FFT data and BiquadFilterNode for band soloing.
 *
 * This module provides real-time frequency and level data from the Web Audio API,
 * plus interactive frequency band soloing using bandpass filters.
 */

export interface FrequencyBand {
  label: string;
  shortLabel: string;
  minHz: number;
  maxHz: number;
  centerHz: number;
  color: string;
}

export const FREQUENCY_BANDS: FrequencyBand[] = [
  { label: 'Sub',      shortLabel: 'Sub',  minHz: 20,    maxHz: 120,   centerHz: 49,   color: '#5ca7ff' },
  { label: 'Low',      shortLabel: 'Low',  minHz: 120,   maxHz: 500,   centerHz: 245,  color: '#4db8ff' },
  { label: 'Low-Mid',  shortLabel: 'LM',   minHz: 500,   maxHz: 2000,  centerHz: 1000, color: '#3dc9e0' },
  { label: 'Mid',      shortLabel: 'Mid',  minHz: 2000,  maxHz: 6000,  centerHz: 3464, color: '#3ddbb8' },
  { label: 'High-Mid', shortLabel: 'HM',   minHz: 6000,  maxHz: 12000, centerHz: 8485, color: '#5fd28f' },
  { label: 'High',     shortLabel: 'Hi',   minHz: 12000, maxHz: 20000, centerHz: 15492, color: '#8ee86b' },
];

/**
 * Get frequency data from an AnalyserNode as Float32Array (in dB).
 */
export function getFrequencyData(analyser: AnalyserNode): Float32Array {
  const data = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(data);
  return data;
}

/**
 * Get byte frequency data (0–255 range) for simpler visualizations.
 */
export function getByteFrequencyData(analyser: AnalyserNode): Uint8Array {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  return data;
}

/**
 * Get time-domain data for waveform / level calculation.
 */
export function getTimeDomainData(analyser: AnalyserNode): Float32Array {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  return data;
}

/**
 * Calculate RMS level from time-domain data.
 * Returns value in dB (typically -60 to 0).
 */
export function getRmsLevel(analyser: AnalyserNode): number {
  const data = getTimeDomainData(analyser);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  const rms = Math.sqrt(sum / data.length);
  // Convert to dB, clamp to -60
  const db = rms > 0 ? 20 * Math.log10(rms) : -60;
  return Math.max(-60, db);
}

/**
 * Calculate peak level from time-domain data.
 * Returns value in dB (typically -60 to 0).
 */
export function getPeakLevel(analyser: AnalyserNode): number {
  const data = getTimeDomainData(analyser);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  const db = peak > 0 ? 20 * Math.log10(peak) : -60;
  return Math.max(-60, db);
}

/**
 * Convert a frequency (Hz) to the corresponding FFT bin index.
 */
export function frequencyToBin(
  frequency: number,
  sampleRate: number,
  fftSize: number
): number {
  return Math.round((frequency * fftSize) / sampleRate);
}

/**
 * Convert an FFT bin index to frequency (Hz).
 */
export function binToFrequency(
  bin: number,
  sampleRate: number,
  fftSize: number
): number {
  return (bin * sampleRate) / fftSize;
}

/**
 * Given a pixel X position on a logarithmic frequency axis, return the frequency.
 */
export function xToFrequency(
  x: number,
  width: number,
  minFreq: number,
  maxFreq: number
): number {
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const logFreq = logMin + (x / width) * (logMax - logMin);
  return Math.pow(10, logFreq);
}

/**
 * Given a frequency, return the pixel X position on a logarithmic axis.
 */
export function frequencyToX(
  freq: number,
  width: number,
  minFreq: number,
  maxFreq: number
): number {
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const logFreq = Math.log10(Math.max(freq, minFreq));
  return ((logFreq - logMin) / (logMax - logMin)) * width;
}

/**
 * Determine which frequency band a given frequency falls into.
 * Returns the band index, or -1 if outside all bands.
 */
export function getBandIndexForFrequency(freq: number): number {
  for (let i = 0; i < FREQUENCY_BANDS.length; i++) {
    if (freq >= FREQUENCY_BANDS[i].minHz && freq < FREQUENCY_BANDS[i].maxHz) {
      return i;
    }
  }
  // Handle 20kHz edge
  if (freq >= FREQUENCY_BANDS[FREQUENCY_BANDS.length - 1].maxHz) {
    return FREQUENCY_BANDS.length - 1;
  }
  return -1;
}

/**
 * Create a bandpass filter for soloing a frequency band.
 */
export function createBandSoloFilter(
  audioContext: AudioContext,
  band: FrequencyBand
): BiquadFilterNode {
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = band.centerHz;
  // Q = centerFreq / bandwidth
  const bandwidth = band.maxHz - band.minHz;
  filter.Q.value = band.centerHz / bandwidth;
  return filter;
}

/**
 * Interpolate FFT data to get a smooth value at an arbitrary frequency.
 * Uses linear interpolation between bins.
 */
export function getDbAtFrequency(
  frequencyData: Float32Array,
  freq: number,
  sampleRate: number,
  fftSize: number
): number {
  const binFloat = (freq * fftSize) / sampleRate;
  const binLow = Math.floor(binFloat);
  const binHigh = Math.ceil(binFloat);
  const frac = binFloat - binLow;

  if (binLow < 0 || binHigh >= frequencyData.length) {
    return -100;
  }

  if (binLow === binHigh) {
    return frequencyData[binLow];
  }

  return frequencyData[binLow] * (1 - frac) + frequencyData[binHigh] * frac;
}
