import { describe, expect, it } from 'vitest';
import {
  computeSongDateOpacitiesByAge,
  SONG_DATE_OPACITY_RANGE,
} from './songAgeOpacity';

describe('computeSongDateOpacitiesByAge', () => {
  it('makes oldest songs most visible and newest songs least visible', () => {
    const opacities = computeSongDateOpacitiesByAge([
      { id: 'oldest', latestExportAt: '2024-01-01T00:00:00.000Z' },
      { id: 'middle', latestExportAt: '2024-01-02T00:00:00.000Z' },
      { id: 'newest', latestExportAt: '2024-01-03T00:00:00.000Z' },
    ]);

    expect(opacities.get('oldest')).toBe(SONG_DATE_OPACITY_RANGE.oldest);
    expect(opacities.get('middle')).toBeCloseTo(0.75);
    expect(opacities.get('newest')).toBe(SONG_DATE_OPACITY_RANGE.newest);
  });

  it('distributes opacity evenly across ranked song ages', () => {
    const opacities = computeSongDateOpacitiesByAge([
      { id: 's1', latestExportAt: '2024-01-01T00:00:00.000Z' },
      { id: 's2', latestExportAt: '2024-01-02T00:00:00.000Z' },
      { id: 's3', latestExportAt: '2024-01-03T00:00:00.000Z' },
      { id: 's4', latestExportAt: '2024-01-04T00:00:00.000Z' },
    ]);

    expect(opacities.get('s1')).toBeCloseTo(1);
    expect(opacities.get('s2')).toBeCloseTo(5 / 6);
    expect(opacities.get('s3')).toBeCloseTo(2 / 3);
    expect(opacities.get('s4')).toBeCloseTo(0.5);
  });

  it('uses fallback opacity for unknown dates', () => {
    const opacities = computeSongDateOpacitiesByAge([
      { id: 'known', latestExportAt: '2024-01-01T00:00:00.000Z' },
      { id: 'unknown', latestExportAt: 'not-a-date' },
    ]);

    expect(opacities.get('known')).toBe(SONG_DATE_OPACITY_RANGE.oldest);
    expect(opacities.get('unknown')).toBe(SONG_DATE_OPACITY_RANGE.unknown);
  });
});
