import { describe, expect, it } from 'vitest';
import { buildLoudnessHistoryClipFlags } from './LoudnessHistoryGraph';

describe('buildLoudnessHistoryClipFlags', () => {
  it('returns unclipped flags when no waveform peak bucket reaches the digital ceiling', () => {
    expect(
      buildLoudnessHistoryClipFlags({
        frameCount: 4,
        frameDurationSeconds: 1,
        durationSeconds: 4,
        waveformPeaks: new Float32Array([0.2, 0.7, 0.999, Number.NaN]),
      })
    ).toEqual([false, false, false, false]);
  });

  it('marks the loudness frame that overlaps a clipped waveform bucket', () => {
    expect(
      buildLoudnessHistoryClipFlags({
        frameCount: 4,
        frameDurationSeconds: 1,
        durationSeconds: 4,
        waveformPeaks: new Float32Array([0.2, 1, 0.5, 0.2]),
      })
    ).toEqual([false, true, false, false]);
  });

  it('covers every loudness frame touched by a wider clipped waveform bucket', () => {
    expect(
      buildLoudnessHistoryClipFlags({
        frameCount: 4,
        frameDurationSeconds: 1,
        durationSeconds: 4,
        waveformPeaks: new Float32Array([1, 0.2]),
      })
    ).toEqual([true, true, false, false]);
  });

  it('does not bleed into the next frame when a clipped bucket ends exactly on a frame boundary', () => {
    expect(
      buildLoudnessHistoryClipFlags({
        frameCount: 2,
        frameDurationSeconds: 1,
        durationSeconds: 2,
        waveformPeaks: new Float32Array([1, 0.2]),
      })
    ).toEqual([true, false]);
  });
});
