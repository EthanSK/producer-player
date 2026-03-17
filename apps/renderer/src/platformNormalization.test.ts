/**
 * Platform normalization correctness tests.
 *
 * These tests verify that the normalization preview logic produces correct
 * results that match real-world platform behavior. People release actual
 * music albums based on these values, so every assertion matters.
 */
import { describe, expect, it } from 'vitest';
import type { AudioFileAnalysis } from '@producer-player/contracts';
import {
  computePlatformNormalizationPreview,
  gainDbToLinear,
  getNormalizationPlatformProfile,
  NORMALIZATION_PLATFORM_PROFILES,
  type NormalizationPlatformId,
  type NormalizationPlatformProfile,
} from './platformNormalization';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAnalysis(
  overrides: Partial<AudioFileAnalysis> = {}
): AudioFileAnalysis {
  return {
    filePath: '/test/track.wav',
    measuredWith: 'ffmpeg-ebur128-volumedetect',
    integratedLufs: -14,
    loudnessRangeLufs: 8,
    truePeakDbfs: -1,
    samplePeakDbfs: -0.5,
    meanVolumeDbfs: -16,
    maxMomentaryLufs: -10,
    maxShortTermLufs: -12,
    sampleRateHz: 44100,
    ...overrides,
  };
}

function getProfile(id: NormalizationPlatformId): NormalizationPlatformProfile {
  return getNormalizationPlatformProfile(id);
}

// ---------------------------------------------------------------------------
// Part 1: Platform LUFS target verification
// ---------------------------------------------------------------------------

describe('Platform LUFS targets (verified against authoritative sources)', () => {
  it('Spotify targets -14 LUFS (Spotify for Artists official docs)', () => {
    expect(getProfile('spotify').targetLufs).toBe(-14);
  });

  it('Apple Music targets -16 LUFS (AES TD1008 / Apple Sound Check)', () => {
    expect(getProfile('appleMusic').targetLufs).toBe(-16);
  });

  it('YouTube targets -14 LUFS', () => {
    expect(getProfile('youtube').targetLufs).toBe(-14);
  });

  it('Tidal targets -14 LUFS', () => {
    expect(getProfile('tidal').targetLufs).toBe(-14);
  });
});

// ---------------------------------------------------------------------------
// Part 2: True peak ceiling verification
// ---------------------------------------------------------------------------

describe('True peak ceilings', () => {
  it('Spotify, Apple Music, YouTube, Tidal use -1 dBTP ceiling', () => {
    expect(getProfile('spotify').truePeakCeilingDbtp).toBe(-1);
    expect(getProfile('appleMusic').truePeakCeilingDbtp).toBe(-1);
    expect(getProfile('youtube').truePeakCeilingDbtp).toBe(-1);
    expect(getProfile('tidal').truePeakCeilingDbtp).toBe(-1);
  });

  it('Amazon Music uses a stricter -2 dBTP ceiling', () => {
    expect(getProfile('amazon').truePeakCeilingDbtp).toBe(-2);
  });
});

// ---------------------------------------------------------------------------
// Part 3: Normalization policy verification
// ---------------------------------------------------------------------------

describe('Normalization policy (up vs down-only)', () => {
  it('Spotify boosts quiet tracks (peak-limited-upward)', () => {
    expect(getProfile('spotify').policy).toBe('peak-limited-upward');
  });

  it('Apple Music boosts quiet tracks (peak-limited-upward)', () => {
    expect(getProfile('appleMusic').policy).toBe('peak-limited-upward');
  });

  it('YouTube only turns down loud tracks (down-only)', () => {
    expect(getProfile('youtube').policy).toBe('down-only');
  });

  it('Tidal only turns down loud tracks (down-only)', () => {
    expect(getProfile('tidal').policy).toBe('down-only');
  });
});

// ---------------------------------------------------------------------------
// Part 4: Normalization calculation correctness
// ---------------------------------------------------------------------------

describe('computePlatformNormalizationPreview', () => {
  describe('null/invalid input handling', () => {
    it('returns null when analysis is null', () => {
      expect(computePlatformNormalizationPreview(null, getProfile('spotify'))).toBeNull();
    });

    it('returns null when integratedLufs is null', () => {
      const analysis = makeAnalysis({ integratedLufs: null });
      expect(computePlatformNormalizationPreview(analysis, getProfile('spotify'))).toBeNull();
    });

    it('returns null when integratedLufs is NaN', () => {
      const analysis = makeAnalysis({ integratedLufs: NaN });
      expect(computePlatformNormalizationPreview(analysis, getProfile('spotify'))).toBeNull();
    });

    it('returns null when integratedLufs is Infinity', () => {
      const analysis = makeAnalysis({ integratedLufs: Infinity });
      expect(computePlatformNormalizationPreview(analysis, getProfile('spotify'))).toBeNull();
    });
  });

  describe('track at target LUFS (no change needed)', () => {
    it('Spotify: -14 LUFS track → 0 dB gain', () => {
      const analysis = makeAnalysis({ integratedLufs: -14, truePeakDbfs: -1 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      expect(result.rawGainDb).toBe(0);
      expect(result.appliedGainDb).toBe(0);
      expect(result.projectedIntegratedLufs).toBe(-14);
    });

    it('Apple Music: -16 LUFS track → 0 dB gain', () => {
      const analysis = makeAnalysis({ integratedLufs: -16, truePeakDbfs: -1 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('appleMusic'))!;
      expect(result.rawGainDb).toBe(0);
      expect(result.appliedGainDb).toBe(0);
      expect(result.projectedIntegratedLufs).toBe(-16);
    });
  });

  describe('loud track turned down (all platforms)', () => {
    it('Spotify: -8 LUFS track → turned down by 6 dB', () => {
      const analysis = makeAnalysis({ integratedLufs: -8, truePeakDbfs: 0 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      expect(result.rawGainDb).toBe(-6);
      expect(result.appliedGainDb).toBe(-6);
      expect(result.projectedIntegratedLufs).toBe(-14);
      expect(result.limitedByHeadroom).toBe(false);
    });

    it('Apple Music: -10 LUFS track → turned down by 6 dB', () => {
      const analysis = makeAnalysis({ integratedLufs: -10, truePeakDbfs: 0 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('appleMusic'))!;
      expect(result.rawGainDb).toBe(-6);
      expect(result.appliedGainDb).toBe(-6);
      expect(result.projectedIntegratedLufs).toBe(-16);
    });

    it('YouTube: -8 LUFS track → turned down by 6 dB', () => {
      const analysis = makeAnalysis({ integratedLufs: -8, truePeakDbfs: 0 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('youtube'))!;
      expect(result.rawGainDb).toBe(-6);
      expect(result.appliedGainDb).toBe(-6);
      expect(result.projectedIntegratedLufs).toBe(-14);
    });

    it('Tidal: -8 LUFS track → turned down by 6 dB', () => {
      const analysis = makeAnalysis({ integratedLufs: -8, truePeakDbfs: 0 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('tidal'))!;
      expect(result.rawGainDb).toBe(-6);
      expect(result.appliedGainDb).toBe(-6);
      expect(result.projectedIntegratedLufs).toBe(-14);
    });
  });

  describe('quiet track: down-only platforms leave it alone', () => {
    it('YouTube: -20 LUFS track → no boost, left as-is', () => {
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: -6 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('youtube'))!;
      expect(result.rawGainDb).toBe(6);
      expect(result.appliedGainDb).toBe(0);
      expect(result.projectedIntegratedLufs).toBe(-20);
    });

    it('Tidal: -20 LUFS track → no boost, left as-is', () => {
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: -6 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('tidal'))!;
      expect(result.rawGainDb).toBe(6);
      expect(result.appliedGainDb).toBe(0);
      expect(result.projectedIntegratedLufs).toBe(-20);
    });
  });

  describe('quiet track: upward-normalizing platforms boost with headroom cap', () => {
    it('Spotify: -20 LUFS with -5 dBTP peak → boosted to -16 LUFS (Spotify official example)', () => {
      // This is the exact example from Spotify's official documentation:
      // "If a track loudness level is -20 dB LUFS, and its True Peak maximum
      //  is -5 dB FS, we only lift the track up to -16 dB LUFS."
      // Raw gain needed: -14 - (-20) = +6 dB
      // Headroom cap: -1 - (-5) = 4 dB (before hitting -1 dBTP ceiling)
      // Applied: min(6, 4) = 4 dB
      // Projected: -20 + 4 = -16 LUFS
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: -5 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      expect(result.rawGainDb).toBe(6);
      expect(result.appliedGainDb).toBe(4);
      expect(result.projectedIntegratedLufs).toBe(-16);
      expect(result.limitedByHeadroom).toBe(true);
      expect(result.headroomCapDb).toBe(4);
    });

    it('Apple Music: -20 LUFS with -5 dBTP peak → boost capped by headroom', () => {
      // Raw gain needed: -16 - (-20) = +4 dB
      // Headroom: -1 - (-5) = 4 dB
      // Applied: min(4, 4) = 4 dB — exactly at the cap
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: -5 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('appleMusic'))!;
      expect(result.rawGainDb).toBe(4);
      expect(result.appliedGainDb).toBe(4);
      expect(result.projectedIntegratedLufs).toBe(-16);
      expect(result.limitedByHeadroom).toBe(false);
    });

    it('Spotify: -20 LUFS with -10 dBTP peak → full boost applied', () => {
      // Raw gain: +6 dB. Headroom: -1 - (-10) = 9 dB. Plenty of room.
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: -10 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      expect(result.rawGainDb).toBe(6);
      expect(result.appliedGainDb).toBe(6);
      expect(result.projectedIntegratedLufs).toBe(-14);
      expect(result.limitedByHeadroom).toBe(false);
    });

    it('Spotify: quiet track with peak already at 0 dBTP → only +0 headroom, no boost possible', () => {
      // Peak is at 0 dBTP, ceiling is -1 dBTP → headroom is -1 dB (negative!)
      // Capped positive gain = max(0, -1) = 0
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: 0 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      expect(result.rawGainDb).toBe(6);
      expect(result.appliedGainDb).toBe(0);
      expect(result.projectedIntegratedLufs).toBe(-20);
      expect(result.limitedByHeadroom).toBe(true);
    });

    it('Spotify: quiet track with peak above ceiling → 0 boost applied', () => {
      // Peak at +1 dBTP (already over), ceiling is -1 → headroom is -2 dB
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: 1 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      expect(result.appliedGainDb).toBe(0);
      expect(result.limitedByHeadroom).toBe(true);
    });
  });

  describe('missing true peak data on upward-normalizing platforms', () => {
    it('still computes rawGainDb when truePeakDbfs is null', () => {
      const analysis = makeAnalysis({ integratedLufs: -20, truePeakDbfs: null });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      expect(result.rawGainDb).toBe(6);
      // Without true peak data, the code should still apply boost (no cap available)
      expect(result.headroomCapDb).toBeNull();
      expect(result.appliedGainDb).toBe(6);
    });
  });

  describe('rounding', () => {
    it('rounds to 1 decimal place', () => {
      const analysis = makeAnalysis({ integratedLufs: -14.33, truePeakDbfs: -1.67 });
      const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
      // rawGainDb = -14 - (-14.33) = 0.33 → rounds to 0.3
      expect(result.rawGainDb).toBe(0.3);
    });
  });
});

// ---------------------------------------------------------------------------
// Part 5: gainDbToLinear
// ---------------------------------------------------------------------------

describe('gainDbToLinear', () => {
  it('0 dB → gain of 1', () => {
    expect(gainDbToLinear(0)).toBeCloseTo(1, 10);
  });

  it('-6 dB → approximately 0.5', () => {
    expect(gainDbToLinear(-6)).toBeCloseTo(0.5012, 3);
  });

  it('+6 dB → approximately 2', () => {
    expect(gainDbToLinear(6)).toBeCloseTo(1.9953, 3);
  });

  it('-20 dB → 0.1', () => {
    expect(gainDbToLinear(-20)).toBeCloseTo(0.1, 5);
  });

  it('+20 dB → 10', () => {
    expect(gainDbToLinear(20)).toBeCloseTo(10, 5);
  });

  it('NaN → returns 1 (safe fallback)', () => {
    expect(gainDbToLinear(NaN)).toBe(1);
  });

  it('Infinity → returns 1 (safe fallback)', () => {
    expect(gainDbToLinear(Infinity)).toBe(1);
  });

  it('-Infinity → returns 1 (safe fallback)', () => {
    expect(gainDbToLinear(-Infinity)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Part 6: getNormalizationPlatformProfile
// ---------------------------------------------------------------------------

describe('getNormalizationPlatformProfile', () => {
  it('returns the correct profile for each known platform', () => {
    expect(getNormalizationPlatformProfile('spotify').id).toBe('spotify');
    expect(getNormalizationPlatformProfile('appleMusic').id).toBe('appleMusic');
    expect(getNormalizationPlatformProfile('youtube').id).toBe('youtube');
    expect(getNormalizationPlatformProfile('tidal').id).toBe('tidal');
  });

  it('falls back to the first profile for unknown platform IDs', () => {
    const fallback = getNormalizationPlatformProfile('nonexistent' as NormalizationPlatformId);
    expect(fallback.id).toBe(NORMALIZATION_PLATFORM_PROFILES[0].id);
  });
});

// ---------------------------------------------------------------------------
// Part 7: Real-world mastering scenario tests
// ---------------------------------------------------------------------------

describe('Real-world mastering scenarios', () => {
  it('heavily compressed master (-6 LUFS, -0.5 dBTP) on Spotify → turned down 8 dB', () => {
    const analysis = makeAnalysis({ integratedLufs: -6, truePeakDbfs: -0.5 });
    const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
    expect(result.appliedGainDb).toBe(-8);
    expect(result.projectedIntegratedLufs).toBe(-14);
  });

  it('heavily compressed master on YouTube → turned down 8 dB', () => {
    const analysis = makeAnalysis({ integratedLufs: -6, truePeakDbfs: -0.5 });
    const result = computePlatformNormalizationPreview(analysis, getProfile('youtube'))!;
    expect(result.appliedGainDb).toBe(-8);
    expect(result.projectedIntegratedLufs).toBe(-14);
  });

  it('dynamic classical recording (-24 LUFS, -8 dBTP) on Spotify → boosted to max headroom', () => {
    // Raw gain: +10 dB. Headroom: -1 - (-8) = 7 dB. Limited.
    const analysis = makeAnalysis({ integratedLufs: -24, truePeakDbfs: -8 });
    const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
    expect(result.rawGainDb).toBe(10);
    expect(result.appliedGainDb).toBe(7);
    expect(result.projectedIntegratedLufs).toBe(-17);
    expect(result.limitedByHeadroom).toBe(true);
  });

  it('dynamic classical recording on YouTube → left alone (down-only)', () => {
    const analysis = makeAnalysis({ integratedLufs: -24, truePeakDbfs: -8 });
    const result = computePlatformNormalizationPreview(analysis, getProfile('youtube'))!;
    expect(result.appliedGainDb).toBe(0);
    expect(result.projectedIntegratedLufs).toBe(-24);
  });

  it('well-mastered pop track (-13 LUFS, -1.5 dBTP) on Spotify → slight turn-down', () => {
    const analysis = makeAnalysis({ integratedLufs: -13, truePeakDbfs: -1.5 });
    const result = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
    expect(result.appliedGainDb).toBe(-1);
    expect(result.projectedIntegratedLufs).toBe(-14);
  });

  it('well-mastered pop track on Apple Music → slightly boosted', () => {
    // Apple targets -16, track is at -13 → turned down by 3 dB
    const analysis = makeAnalysis({ integratedLufs: -13, truePeakDbfs: -1.5 });
    const result = computePlatformNormalizationPreview(analysis, getProfile('appleMusic'))!;
    expect(result.appliedGainDb).toBe(-3);
    expect(result.projectedIntegratedLufs).toBeCloseTo(-16, 0);
  });

  it('Apple Music -16 LUFS target means quieter playback than Spotify -14 LUFS', () => {
    const analysis = makeAnalysis({ integratedLufs: -10, truePeakDbfs: -1 });
    const spotify = computePlatformNormalizationPreview(analysis, getProfile('spotify'))!;
    const apple = computePlatformNormalizationPreview(analysis, getProfile('appleMusic'))!;
    // Apple should turn down more than Spotify
    expect(apple.appliedGainDb).toBeLessThan(spotify.appliedGainDb);
    expect(apple.projectedIntegratedLufs!).toBeLessThan(spotify.projectedIntegratedLufs!);
  });
});

// ---------------------------------------------------------------------------
// Part 8: Profile data integrity
// ---------------------------------------------------------------------------

describe('Profile data integrity', () => {
  it('all profiles have required fields', () => {
    for (const profile of NORMALIZATION_PLATFORM_PROFILES) {
      expect(profile.id).toBeTruthy();
      expect(profile.label).toBeTruthy();
      expect(profile.shortLabel).toBeTruthy();
      expect(typeof profile.targetLufs).toBe('number');
      expect(Number.isFinite(profile.targetLufs)).toBe(true);
      expect(typeof profile.truePeakCeilingDbtp).toBe('number');
      expect(Number.isFinite(profile.truePeakCeilingDbtp)).toBe(true);
      expect(['peak-limited-upward', 'down-only']).toContain(profile.policy);
      expect(profile.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(profile.description.length).toBeGreaterThan(10);
    }
  });

  it('there are exactly 5 platforms', () => {
    expect(NORMALIZATION_PLATFORM_PROFILES).toHaveLength(5);
  });

  it('platform IDs are unique', () => {
    const ids = NORMALIZATION_PLATFORM_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all LUFS targets are negative', () => {
    for (const profile of NORMALIZATION_PLATFORM_PROFILES) {
      expect(profile.targetLufs).toBeLessThan(0);
    }
  });

  it('all true peak ceilings are negative (below 0 dBTP)', () => {
    for (const profile of NORMALIZATION_PLATFORM_PROFILES) {
      expect(profile.truePeakCeilingDbtp).toBeLessThan(0);
    }
  });
});
