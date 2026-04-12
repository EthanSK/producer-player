/**
 * Tests for the combined gain formula that governs how Platform Normalization
 * and Level Match interact when listening to the reference track.
 *
 * Regression target: the bug where both toggles on simultaneously produced
 * a reference track played at a different loudness than the mix, breaking
 * the A/B comparison invariant.
 */
import { describe, expect, it } from 'vitest';
import {
  computeCombinedAppliedGainDb,
  computeEffectiveReferenceLevelMatchGainDb,
} from './referenceLevelMatchGain';

describe('computeEffectiveReferenceLevelMatchGainDb', () => {
  it('returns the raw level match gain when platform preview is off', () => {
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: -4,
        normalizationPreviewEnabled: false,
      })
    ).toBe(-4);
  });

  it('returns 0 when platform preview is on (override)', () => {
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: -4,
        normalizationPreviewEnabled: true,
      })
    ).toBe(0);
  });

  it('still returns 0 when level match would be +10 dB and platform preview is on', () => {
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: 10,
        normalizationPreviewEnabled: true,
      })
    ).toBe(0);
  });
});

describe('computeCombinedAppliedGainDb (A/B invariant)', () => {
  describe('Level Match only (platform preview off)', () => {
    it('applies level match gain to reference', () => {
      // mix -12 LUFS, ref -8 LUFS → level match = -4 dB
      expect(
        computeCombinedAppliedGainDb({
          platformNormalizationGainDb: 0,
          referenceLevelMatchGainDb: -4,
          normalizationPreviewEnabled: false,
        })
      ).toBe(-4);
    });
  });

  describe('Platform preview only (level match off)', () => {
    it('applies platform normalization gain', () => {
      expect(
        computeCombinedAppliedGainDb({
          platformNormalizationGainDb: -6,
          referenceLevelMatchGainDb: 0,
          normalizationPreviewEnabled: true,
        })
      ).toBe(-6);
    });
  });

  describe('Both on: platform preview + level match (the fixed bug)', () => {
    it('reference plays at platform target, no extra level match gain', () => {
      // Repro scenario: mix at -12 LUFS, ref at -8 LUFS, Spotify target -14.
      // Mix path: platformGain = -2 dB → plays at -14 LUFS.
      // Ref path (pre-fix): platformGain = -6 dB + levelMatch (-4 dB) = -10 dB
      //                     → -18 LUFS (4 dB below mix). BUG.
      // Ref path (post-fix): platformGain = -6 dB + 0 = -6 dB
      //                      → -14 LUFS. Matches mix. INVARIANT PRESERVED.
      const mixAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -2, // mix -12 → Spotify -14
        referenceLevelMatchGainDb: 0, // not reference mode, so 0
        normalizationPreviewEnabled: true,
      });
      const refAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -6, // ref -8 → Spotify -14
        referenceLevelMatchGainDb: -4, // would be mix(-12) - ref(-8) = -4
        normalizationPreviewEnabled: true,
      });

      // Mix plays at -12 + (-2) = -14 LUFS.
      // Ref plays at -8 + (-6) = -14 LUFS.
      // Both land at the platform target — level match is redundant.
      const mixPlayedLufs = -12 + mixAppliedGain;
      const refPlayedLufs = -8 + refAppliedGain;
      expect(mixPlayedLufs).toBe(-14);
      expect(refPlayedLufs).toBe(-14);
      expect(mixPlayedLufs).toBe(refPlayedLufs);
    });

    it('works for Apple Music target (-16 LUFS)', () => {
      // mix -10 LUFS → -6 dB → -16. ref -14 LUFS → -2 dB → -16.
      // Level match (if it were active) = mix - ref = +4 dB.
      const mixAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -6,
        referenceLevelMatchGainDb: 0,
        normalizationPreviewEnabled: true,
      });
      const refAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -2,
        referenceLevelMatchGainDb: 4,
        normalizationPreviewEnabled: true,
      });
      expect(-10 + mixAppliedGain).toBe(-16);
      expect(-14 + refAppliedGain).toBe(-16);
    });
  });
});
