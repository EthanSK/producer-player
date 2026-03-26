import { describe, expect, it } from 'vitest';
import {
  clampToRange,
  sampleSeriesAtRatio,
  sampleSeriesAtTime,
  sampleSpectrumDbAtFrequency,
} from './graphHoverSampling';

describe('graphHoverSampling', () => {
  it('clamps numbers into range bounds', () => {
    expect(clampToRange(-5, 0, 10)).toBe(0);
    expect(clampToRange(3, 0, 10)).toBe(3);
    expect(clampToRange(42, 0, 10)).toBe(10);
  });

  it('samples a value by ratio with linear interpolation', () => {
    const values = [0, 10, 20, 30];
    expect(sampleSeriesAtRatio(values, 0)).toBe(0);
    expect(sampleSeriesAtRatio(values, 1)).toBe(30);
    expect(sampleSeriesAtRatio(values, 0.5)).toBe(15);
  });

  it('samples a time series with clamped interpolation', () => {
    const frames = [-30, -20, -10, 0];
    expect(sampleSeriesAtTime(frames, 1, 0)).toBe(-30);
    expect(sampleSeriesAtTime(frames, 1, 1.5)).toBe(-15);
    expect(sampleSeriesAtTime(frames, 1, 9)).toBe(0);
  });

  it('samples spectrum dB at a frequency using bin interpolation', () => {
    const bins = [-90, -60, -30, 0];
    // sampleRate=8000, fftSize=8 => bin index ~= freq/1000.
    expect(sampleSpectrumDbAtFrequency(bins, 1500, 8, 8000, -120)).toBeCloseTo(-45, 5);
    expect(sampleSpectrumDbAtFrequency(bins, 5000, 8, 8000, -120)).toBe(0);
  });

  it('falls back when spectrum inputs are invalid', () => {
    expect(sampleSpectrumDbAtFrequency([], 1000, 8, 8000, -111)).toBe(-111);
    expect(sampleSpectrumDbAtFrequency([NaN], 1000, 8, 8000, -111)).toBe(-111);
  });
});
