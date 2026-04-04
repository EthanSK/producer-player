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
 * Create a peaking EQ filter for a frequency band.
 * Type "peaking" boosts or cuts around the center frequency.
 */
export function createPeakingEqFilter(
  audioContext: AudioContext,
  band: FrequencyBand,
  gainDb: number = 0
): BiquadFilterNode {
  const filter = audioContext.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = band.centerHz;
  // Q chosen to cover the band width smoothly
  const bandwidth = band.maxHz - band.minHz;
  filter.Q.value = band.centerHz / bandwidth;
  filter.gain.value = gainDb;
  return filter;
}

/**
 * Compute the combined EQ gain curve for visualization.
 * Returns an array of { freq, gainDb } points sampled logarithmically across the spectrum.
 *
 * Computes the true cascaded frequency response by multiplying the complex
 * transfer functions of all active peaking filters at each frequency point.
 * This produces the exact combined magnitude response, yielding a smooth curve
 * when adjacent bands share the same gain.
 */
export function computeEqGainCurve(
  gains: readonly number[],
  numPoints: number = 256,
  minFreq: number = 20,
  maxFreq: number = 20000,
  sampleRate: number = 44100
): Array<{ freq: number; gainDb: number }> {
  const points: Array<{ freq: number; gainDb: number }> = [];
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);

  // Pre-compute biquad coefficients for each active band
  const filters: Array<{
    b0: number; b1: number; b2: number;
    a0: number; a1: number; a2: number;
  }> = [];

  for (let b = 0; b < FREQUENCY_BANDS.length; b++) {
    const g = gains[b];
    if (g === 0) continue;

    const band = FREQUENCY_BANDS[b];
    const bandwidth = band.maxHz - band.minHz;
    const Q = band.centerHz / bandwidth;
    const A = Math.pow(10, g / 40); // amplitude factor for peaking
    const w0 = (2 * Math.PI * band.centerHz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);

    // Peaking EQ biquad coefficients (Audio EQ Cookbook)
    filters.push({
      b0: 1 + alpha * A,
      b1: -2 * Math.cos(w0),
      b2: 1 - alpha * A,
      a0: 1 + alpha / A,
      a1: -2 * Math.cos(w0),
      a2: 1 - alpha / A,
    });
  }

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const freq = Math.pow(10, logMin + t * (logMax - logMin));
    const w = (2 * Math.PI * freq) / sampleRate;
    const cosw = Math.cos(w);
    const cos2w = Math.cos(2 * w);
    const sinw = Math.sin(w);
    const sin2w = Math.sin(2 * w);

    // Multiply complex transfer functions: H_total = H_1 * H_2 * ... * H_n
    // Start with unity (1 + 0j)
    let realAcc = 1;
    let imagAcc = 0;

    for (const f of filters) {
      // Numerator: b0 + b1*z^-1 + b2*z^-2 evaluated at z = e^(jw)
      const nReal = f.b0 + f.b1 * cosw + f.b2 * cos2w;
      const nImag = -(f.b1 * sinw + f.b2 * sin2w);
      // Denominator: a0 + a1*z^-1 + a2*z^-2
      const dReal = f.a0 + f.a1 * cosw + f.a2 * cos2w;
      const dImag = -(f.a1 * sinw + f.a2 * sin2w);

      // H_k = N / D via complex division
      const dMagSq = dReal * dReal + dImag * dImag;
      const hReal = (nReal * dReal + nImag * dImag) / dMagSq;
      const hImag = (nImag * dReal - nReal * dImag) / dMagSq;

      // Multiply into running product: acc = acc * H_k
      const nextReal = realAcc * hReal - imagAcc * hImag;
      const nextImag = realAcc * hImag + imagAcc * hReal;
      realAcc = nextReal;
      imagAcc = nextImag;
    }

    const magSq = realAcc * realAcc + imagAcc * imagAcc;
    const gainDb = magSq > 0 ? 10 * Math.log10(magSq) : -100;
    points.push({ freq, gainDb });
  }

  return points;
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
