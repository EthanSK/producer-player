import { describe, expect, it } from 'vitest';
import { computePlaybackGainState } from './playbackGainModel';

describe('computePlaybackGainState', () => {
  it('keeps the final player volume separate from preview transforms', () => {
    const result = computePlaybackGainState({
      baseVolume: 0.25,
      transformGainDb: 6,
    });

    expect(result.playerVolumeLinear).toBe(0.25);
    expect(result.transformGainLinear).toBeCloseTo(1.9953, 3);
    expect(result.audibleGainLinear).toBeCloseTo(0.4988, 3);
  });

  it('clamps the slider volume without mutating transform gain', () => {
    const result = computePlaybackGainState({
      baseVolume: 2,
      transformGainDb: -6,
    });

    expect(result.playerVolumeLinear).toBe(1);
    expect(result.transformGainLinear).toBeCloseTo(0.5012, 3);
    expect(result.audibleGainLinear).toBeCloseTo(0.5012, 3);
  });

  it('treats invalid persisted slider values as full-volume fallback', () => {
    const result = computePlaybackGainState({
      baseVolume: Number.NaN,
      transformGainDb: 0,
    });

    expect(result.playerVolumeLinear).toBe(1);
    expect(result.transformGainLinear).toBe(1);
    expect(result.audibleGainLinear).toBe(1);
  });
});
