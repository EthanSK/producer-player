/**
 * Audio analysis correctness tests.
 *
 * These verify the audio measurement calculations used throughout
 * the app are mathematically correct.
 */
import { describe, expect, it } from 'vitest';
import { estimateShortTermLufs, type TrackAnalysisResult } from './audioAnalysis';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrackAnalysis(
  overrides: Partial<TrackAnalysisResult> = {}
): TrackAnalysisResult {
  return {
    peakDbfs: -1,
    integratedLufsEstimate: -14,
    frameLoudnessDbfs: [-14, -14, -14, -14, -14, -14, -14, -14, -14, -14, -14, -14],
    frameDurationSeconds: 0.25,
    durationSeconds: 3,
    tonalBalance: { low: 0.33, mid: 0.34, high: 0.33 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// estimateShortTermLufs
// ---------------------------------------------------------------------------

describe('estimateShortTermLufs', () => {
  it('returns -96 dB for empty frame data', () => {
    const analysis = makeTrackAnalysis({ frameLoudnessDbfs: [] });
    expect(estimateShortTermLufs(analysis, 1)).toBe(-96);
  });

  it('returns -96 for zero frame duration', () => {
    const analysis = makeTrackAnalysis({ frameDurationSeconds: 0 });
    expect(estimateShortTermLufs(analysis, 1)).toBe(-96);
  });

  it('returns a finite value for valid analysis at midpoint', () => {
    const analysis = makeTrackAnalysis();
    const result = estimateShortTermLufs(analysis, 1.5);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('handles currentTimeSeconds = 0 gracefully', () => {
    const analysis = makeTrackAnalysis();
    const result = estimateShortTermLufs(analysis, 0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('handles negative currentTimeSeconds gracefully', () => {
    const analysis = makeTrackAnalysis();
    const result = estimateShortTermLufs(analysis, -5);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('handles currentTimeSeconds beyond duration', () => {
    const analysis = makeTrackAnalysis();
    const result = estimateShortTermLufs(analysis, 999);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('handles NaN currentTimeSeconds', () => {
    const analysis = makeTrackAnalysis();
    const result = estimateShortTermLufs(analysis, NaN);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('consistent frames at -14 dBFS produce approximately -14 dBFS short-term estimate', () => {
    const frames = new Array(12).fill(-14);
    const analysis = makeTrackAnalysis({
      frameLoudnessDbfs: frames,
      frameDurationSeconds: 0.25,
      durationSeconds: 3,
    });
    const result = estimateShortTermLufs(analysis, 3);
    // Should be close to -14 since all frames are the same level
    expect(result).toBeCloseTo(-14, 0);
  });

  it('silent frames produce very low estimate', () => {
    const frames = new Array(12).fill(-96);
    const analysis = makeTrackAnalysis({
      frameLoudnessDbfs: frames,
      frameDurationSeconds: 0.25,
      durationSeconds: 3,
    });
    const result = estimateShortTermLufs(analysis, 3);
    expect(result).toBeLessThan(-80);
  });

  it('varying frame levels produce an average somewhere in between', () => {
    // Mix of loud and quiet frames
    const frames = [-6, -6, -6, -6, -20, -20, -20, -20, -6, -6, -6, -6];
    const analysis = makeTrackAnalysis({
      frameLoudnessDbfs: frames,
      frameDurationSeconds: 0.25,
      durationSeconds: 3,
    });
    const result = estimateShortTermLufs(analysis, 3);
    // Should be between -20 and -6, closer to -6 due to RMS averaging
    expect(result).toBeGreaterThan(-20);
    expect(result).toBeLessThan(-6);
  });
});

// ---------------------------------------------------------------------------
// Tonal balance sanity checks
// ---------------------------------------------------------------------------

describe('TonalBalanceSnapshot interface', () => {
  it('default test analysis has low + mid + high summing close to 1', () => {
    const analysis = makeTrackAnalysis();
    const sum =
      analysis.tonalBalance.low +
      analysis.tonalBalance.mid +
      analysis.tonalBalance.high;
    expect(sum).toBeCloseTo(1, 1);
  });
});
