import {
  IDEAL_CURVE_MAX_FREQ,
  IDEAL_CURVE_MIN_FREQ,
  IDEAL_CURVE_POINT_COUNT,
  IDEAL_STEM_IDS,
  type IdealCurvePoint,
  type IdealStemId,
} from './idealCurves';

export const IDEAL_STEM_PROVIDER_ID = 'web-audio-proxy-v1';
export const IDEAL_STEM_PROVIDER_LABEL = 'Web Audio proxy stems';
export const IDEAL_STEM_PROVIDER_DISCLOSURE =
  'Local Web Audio fallback: stem-like filtered analysis/audition proxies, not ML Demucs/HTDemucs source separation.';

const MIN_DB = -96;
const CURVE_FLOOR_DB = -24;
const OUTPUT_LIMIT = 0.98;

export interface IdealStemMetrics {
  peakDbfs: number;
  rmsDbfs: number;
  durationSeconds: number;
  sampleRate: number;
}

export interface IdealStemProxyData {
  stemId: IdealStemId;
  samples: Float32Array;
  curve: IdealCurvePoint[];
  metrics: IdealStemMetrics;
}

export type IdealStemProxyDataByStem = Record<IdealStemId, IdealStemProxyData>;

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function amplitudeToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return MIN_DB;
  }
  return Math.max(MIN_DB, 20 * Math.log10(value));
}

function normalizeCutoff(cutoffHz: number, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  return clamp(cutoffHz, 10, Math.max(10, nyquist - 10));
}

function lowPassCoefficients(cutoffHz: number, sampleRate: number, q = Math.SQRT1_2): BiquadCoefficients {
  const cutoff = normalizeCutoff(cutoffHz, sampleRate);
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const b0 = (1 - cos) / 2;
  const b1 = 1 - cos;
  const b2 = (1 - cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function highPassCoefficients(cutoffHz: number, sampleRate: number, q = Math.SQRT1_2): BiquadCoefficients {
  const cutoff = normalizeCutoff(cutoffHz, sampleRate);
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(input: Float32Array, coefficients: BiquadCoefficients): Float32Array {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i];
    const y0 =
      coefficients.b0 * x0 +
      coefficients.b1 * x1 +
      coefficients.b2 * x2 -
      coefficients.a1 * y1 -
      coefficients.a2 * y2;
    output[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = output[i];
  }

  return output;
}

function lowPass(input: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  return applyBiquad(input, lowPassCoefficients(cutoffHz, sampleRate));
}

function highPass(input: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  return applyBiquad(input, highPassCoefficients(cutoffHz, sampleRate));
}

function bandPass(input: Float32Array, lowHz: number, highHz: number, sampleRate: number): Float32Array {
  return lowPass(highPass(input, lowHz, sampleRate), highHz, sampleRate);
}

function mixSignals(length: number, parts: ReadonlyArray<{ samples: Float32Array; gain: number }>): Float32Array {
  const output = new Float32Array(length);
  for (const part of parts) {
    const count = Math.min(length, part.samples.length);
    for (let i = 0; i < count; i += 1) {
      output[i] += part.samples[i] * part.gain;
    }
  }
  normalizeForAudition(output);
  return output;
}

function subtractSignals(
  source: Float32Array,
  sampleRate: number,
  parts: ReadonlyArray<{ samples: Float32Array; gain: number }>,
): Float32Array {
  const output = new Float32Array(source.length);
  output.set(source);
  for (const part of parts) {
    const count = Math.min(output.length, part.samples.length);
    for (let i = 0; i < count; i += 1) {
      output[i] -= part.samples[i] * part.gain;
    }
  }
  // A gentle high-pass keeps the residual "other" audition from becoming a
  // second bass stem when the simple proxy filters overlap.
  const cleaned = highPass(output, 120, sampleRate);
  normalizeForAudition(cleaned);
  return cleaned;
}

function normalizeForAudition(samples: Float32Array): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    if (!Number.isFinite(value)) {
      samples[i] = 0;
      continue;
    }
    peak = Math.max(peak, Math.abs(value));
  }

  if (peak <= OUTPUT_LIMIT || peak <= 0) {
    return;
  }

  const gain = OUTPUT_LIMIT / peak;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] *= gain;
  }
}

export function createMonoSamplesFromChannels(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array();
  }

  const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      mono[i] += channel[i] / channels.length;
    }
  }
  return mono;
}

export function extractProxyStemSamples(
  monoInput: Float32Array,
  sampleRate: number,
): Record<IdealStemId, Float32Array> {
  const source = new Float32Array(monoInput.length);
  source.set(monoInput);

  const bass = lowPass(source, 185, sampleRate);
  normalizeForAudition(bass);

  const vocalBody = bandPass(source, 140, 6500, sampleRate);
  const vocalPresence = bandPass(source, 1200, 7200, sampleRate);
  const vocals = mixSignals(source.length, [
    { samples: vocalBody, gain: 0.72 },
    { samples: vocalPresence, gain: 0.42 },
  ]);

  const kick = bandPass(source, 35, 140, sampleRate);
  const snareBody = bandPass(source, 160, 900, sampleRate);
  const cymbalSnap = highPass(source, 2600, sampleRate);
  const drums = mixSignals(source.length, [
    { samples: kick, gain: 0.95 },
    { samples: snareBody, gain: 0.36 },
    { samples: cymbalSnap, gain: 0.52 },
  ]);

  const rawOther = subtractSignals(source, sampleRate, [
    { samples: bass, gain: 0.75 },
    { samples: vocals, gain: 0.34 },
    { samples: drums, gain: 0.28 },
  ]);
  const other = bandPass(rawOther, 140, 12000, sampleRate);
  normalizeForAudition(other);

  return { vocals, drums, bass, other };
}

function calculateMetrics(samples: Float32Array, sampleRate: number): IdealStemMetrics {
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const absolute = Math.abs(sample);
    if (absolute > peak) peak = absolute;
    sumSquares += sample * sample;
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  return {
    peakDbfs: amplitudeToDb(peak),
    rmsDbfs: amplitudeToDb(rms),
    durationSeconds: sampleRate > 0 ? samples.length / sampleRate : 0,
    sampleRate,
  };
}

function calculateBandRms(samples: Float32Array, sampleRate: number, lowHz: number, highHz: number): number {
  let filtered: Float32Array;
  if (lowHz <= IDEAL_CURVE_MIN_FREQ) {
    filtered = lowPass(samples, highHz, sampleRate);
  } else if (highHz >= Math.min(IDEAL_CURVE_MAX_FREQ, sampleRate / 2 - 20)) {
    filtered = highPass(samples, lowHz, sampleRate);
  } else {
    filtered = bandPass(samples, lowHz, highHz, sampleRate);
  }

  let sumSquares = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    sumSquares += filtered[i] * filtered[i];
  }
  return filtered.length > 0 ? Math.sqrt(sumSquares / filtered.length) : 0;
}

const CURVE_BANDS: ReadonlyArray<{ lowHz: number; highHz: number; centerHz: number }> = [
  { lowHz: 20, highHz: 55, centerHz: 38 },
  { lowHz: 55, highHz: 120, centerHz: 80 },
  { lowHz: 120, highHz: 260, centerHz: 175 },
  { lowHz: 260, highHz: 600, centerHz: 395 },
  { lowHz: 600, highHz: 1400, centerHz: 915 },
  { lowHz: 1400, highHz: 3200, centerHz: 2100 },
  { lowHz: 3200, highHz: 7200, centerHz: 4800 },
  { lowHz: 7200, highHz: 14000, centerHz: 10000 },
  { lowHz: 14000, highHz: 20000, centerHz: 17000 },
];

export function buildSpectrumCurveFromSamples(
  samples: Float32Array,
  sampleRate: number,
  pointCount = IDEAL_CURVE_POINT_COUNT,
): IdealCurvePoint[] {
  const nyquist = Math.max(IDEAL_CURVE_MIN_FREQ * 2, sampleRate / 2);
  const usableMaxFreq = Math.min(IDEAL_CURVE_MAX_FREQ, nyquist - 20);
  const safePointCount = Math.max(2, Math.floor(pointCount));
  const bandPoints = CURVE_BANDS
    .filter((band) => band.lowHz < usableMaxFreq)
    .map((band) => {
      const highHz = Math.min(band.highHz, usableMaxFreq);
      const centerHz = clamp(band.centerHz, IDEAL_CURVE_MIN_FREQ, usableMaxFreq);
      return {
        freq: centerHz,
        db: amplitudeToDb(calculateBandRms(samples, sampleRate, band.lowHz, highHz)),
      };
    });

  if (bandPoints.length === 0) {
    return Array.from({ length: safePointCount }, (_, index) => {
      const t = index / (safePointCount - 1);
      const freq = Math.pow(
        10,
        Math.log10(IDEAL_CURVE_MIN_FREQ) +
          t * (Math.log10(IDEAL_CURVE_MAX_FREQ) - Math.log10(IDEAL_CURVE_MIN_FREQ)),
      );
      return { freq, gainDb: CURVE_FLOOR_DB };
    });
  }

  const maxDb = Math.max(...bandPoints.map((point) => point.db));
  const normalized = bandPoints.map((point) => ({
    freq: point.freq,
    gainDb: clamp(point.db - maxDb, CURVE_FLOOR_DB, 6),
  }));

  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  const anchors = [
    { freq: IDEAL_CURVE_MIN_FREQ, gainDb: first.gainDb },
    ...normalized,
    { freq: IDEAL_CURVE_MAX_FREQ, gainDb: last.gainDb },
  ];

  const logMin = Math.log10(IDEAL_CURVE_MIN_FREQ);
  const logMax = Math.log10(IDEAL_CURVE_MAX_FREQ);
  const curve: IdealCurvePoint[] = [];
  for (let i = 0; i < safePointCount; i += 1) {
    const t = i / (safePointCount - 1);
    const freq = Math.pow(10, logMin + t * (logMax - logMin));
    curve.push({ freq, gainDb: interpolateLogCurve(freq, anchors) });
  }
  return curve;
}

function interpolateLogCurve(freq: number, anchors: readonly IdealCurvePoint[]): number {
  if (freq <= anchors[0].freq) return anchors[0].gainDb;
  const last = anchors[anchors.length - 1];
  if (freq >= last.freq) return last.gainDb;

  const logFreq = Math.log10(freq);
  for (let i = 1; i < anchors.length; i += 1) {
    const previous = anchors[i - 1];
    const next = anchors[i];
    if (freq <= next.freq) {
      const start = Math.log10(previous.freq);
      const end = Math.log10(next.freq);
      const t = end === start ? 0 : (logFreq - start) / (end - start);
      return previous.gainDb + (next.gainDb - previous.gainDb) * t;
    }
  }
  return last.gainDb;
}

export function buildIdealStemProxyData(
  monoInput: Float32Array,
  sampleRate: number,
): IdealStemProxyDataByStem {
  const samplesByStem = extractProxyStemSamples(monoInput, sampleRate);
  return IDEAL_STEM_IDS.reduce((result, stemId) => {
    const samples = samplesByStem[stemId];
    result[stemId] = {
      stemId,
      samples,
      curve: buildSpectrumCurveFromSamples(samples, sampleRate),
      metrics: calculateMetrics(samples, sampleRate),
    };
    return result;
  }, {} as IdealStemProxyDataByStem);
}

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = clamp(samples[i], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export function listIdealStemIds(): readonly IdealStemId[] {
  return IDEAL_STEM_IDS;
}
