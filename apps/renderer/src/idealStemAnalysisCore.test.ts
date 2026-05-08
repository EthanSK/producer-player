import { describe, expect, it } from 'vitest';
import { IDEAL_STEM_IDS } from './idealCurves';
import {
  buildIdealStemProxyData,
  buildSpectrumCurveFromSamples,
  encodeMonoPcm16Wav,
} from './idealStemAnalysisCore';

function makeSine(freq: number, sampleRate: number, seconds: number, gain = 1): Float32Array {
  const length = Math.round(sampleRate * seconds);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * gain;
  }
  return samples;
}

function mixSignals(signals: readonly Float32Array[]): Float32Array {
  const length = Math.max(...signals.map((signal) => signal.length));
  const mixed = new Float32Array(length);
  for (const signal of signals) {
    for (let i = 0; i < signal.length; i += 1) {
      mixed[i] += signal[i] / signals.length;
    }
  }
  return mixed;
}

function nearestGain(curve: readonly { freq: number; gainDb: number }[], freq: number): number {
  return curve.reduce((best, point) => (
    Math.abs(Math.log10(point.freq) - Math.log10(freq)) <
    Math.abs(Math.log10(best.freq) - Math.log10(freq))
      ? point
      : best
  )).gainDb;
}

describe('ideal stem Web Audio fallback core', () => {
  it('extracts deterministic proxy stems and per-stem curves', () => {
    const sampleRate = 44100;
    const source = mixSignals([
      makeSine(80, sampleRate, 0.25, 0.8),
      makeSine(1000, sampleRate, 0.25, 0.45),
      makeSine(5000, sampleRate, 0.25, 0.35),
    ]);

    const result = buildIdealStemProxyData(source, sampleRate);
    expect(Object.keys(result).sort()).toEqual([...IDEAL_STEM_IDS].sort());

    for (const stemId of IDEAL_STEM_IDS) {
      expect(result[stemId].samples.length).toBe(source.length);
      expect(result[stemId].curve.length).toBeGreaterThan(32);
      expect(Number.isFinite(result[stemId].metrics.peakDbfs)).toBe(true);
      expect(Number.isFinite(result[stemId].metrics.rmsDbfs)).toBe(true);
    }

    expect(nearestGain(result.bass.curve, 80)).toBeGreaterThan(nearestGain(result.bass.curve, 5000));
    expect(nearestGain(result.drums.curve, 5000)).toBeGreaterThan(nearestGain(result.drums.curve, 500));
  });

  it('derives normalized spectrum curves without retaining decoded audio buffers', () => {
    const sampleRate = 44100;
    const source = makeSine(120, sampleRate, 0.1, 0.7);
    const curve = buildSpectrumCurveFromSamples(source, sampleRate, 64);

    expect(curve).toHaveLength(64);
    expect(curve[0].freq).toBeCloseTo(20, 8);
    expect(curve[curve.length - 1].freq).toBeCloseTo(20000, 8);
    expect(Math.max(...curve.map((point) => point.gainDb))).toBeCloseTo(0, 1);
    expect(nearestGain(curve, 120)).toBeGreaterThan(nearestGain(curve, 8000));
  });

  it('encodes audition proxies as mono PCM WAV files', () => {
    const wav = encodeMonoPcm16Wav(new Float32Array([0, 0.5, -0.5]), 44100);
    const view = new DataView(wav);
    const read = (offset: number, length: number): string =>
      String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));

    expect(read(0, 4)).toBe('RIFF');
    expect(read(8, 4)).toBe('WAVE');
    expect(read(36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
  });
});
