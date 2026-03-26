import { describe, expect, it } from 'vitest';
import { buildLoudnessHistogramData } from './LoudnessHistogram';

describe('buildLoudnessHistogramData', () => {
  it('returns empty bins for empty input', () => {
    const histogram = buildLoudnessHistogramData([]);

    expect(histogram.totalSamples).toBe(0);
    expect(histogram.bins.length).toBe(60);
    expect(histogram.bins.every((count) => count === 0)).toBe(true);
  });

  it('clamps out-of-range values into edge bins', () => {
    const histogram = buildLoudnessHistogramData([
      -96,
      -60,
      -59.1,
      -30,
      -0.01,
      0,
      5,
      NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);

    expect(histogram.totalSamples).toBe(7);
    expect(histogram.bins[0]).toBe(3); // -96, -60, -59.1
    expect(histogram.bins[30]).toBe(1); // -30
    expect(histogram.bins[59]).toBe(3); // -0.01, 0, 5

    const sum = histogram.bins.reduce((acc, value) => acc + value, 0);
    expect(sum).toBe(histogram.totalSamples);
  });

  it('bins fractional values using floor semantics', () => {
    const histogram = buildLoudnessHistogramData([-20.2, -20.8]);
    expect(histogram.totalSamples).toBe(2);
    expect(histogram.bins[39]).toBe(2);
  });
});
