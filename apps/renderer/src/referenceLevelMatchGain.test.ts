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

  it('returns 0 when platform preview is on and no projected LUFS supplied (legacy fallback)', () => {
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: -4,
        normalizationPreviewEnabled: true,
      })
    ).toBe(0);
  });

  it('still returns 0 when level match would be +10 dB and platform preview is on (no projected)', () => {
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: 10,
        normalizationPreviewEnabled: true,
      })
    ).toBe(0);
  });

  it('returns residual delta when both projected LUFS are supplied and they differ', () => {
    // YouTube (down-only), mix -20 LUFS, ref -18 LUFS. Both below target.
    // Both get 0 platform gain → projected LUFS stay the same as input.
    // Raw level match = mix - ref = -20 - (-18) = -2.
    // But with normalization preview on, effective level match should also be
    // the residual: -20 - (-18) = -2.
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: -2,
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -20,
        referenceProjectedLufs: -18,
      })
    ).toBe(-2);
  });

  it('returns 0 when projected LUFS are equal (both converged to target)', () => {
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: -4,
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -14,
        referenceProjectedLufs: -14,
      })
    ).toBe(0);
  });

  it('handles partial null projected LUFS (falls back to 0)', () => {
    expect(
      computeEffectiveReferenceLevelMatchGainDb({
        referenceLevelMatchGainDb: -4,
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -14,
        referenceProjectedLufs: null,
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

  describe('Both on: full convergence (Spotify/Apple Music, tracks above target)', () => {
    it('reference plays at platform target, level match is 0', () => {
      // Repro scenario: mix at -12 LUFS, ref at -8 LUFS, Spotify target -14.
      // Both above target → full convergence → projected both = -14.
      const mixAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -2,
        referenceLevelMatchGainDb: 0,
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -14,
        referenceProjectedLufs: -14,
      });
      const refAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -6,
        referenceLevelMatchGainDb: -4,
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -14,
        referenceProjectedLufs: -14,
      });
      expect(-12 + mixAppliedGain).toBe(-14);
      expect(-8 + refAppliedGain).toBe(-14);
    });
  });

  describe('Both on: partial convergence (down-only platform, tracks below target)', () => {
    it('residual delta preserves A/B invariant on YouTube when both tracks are below target', () => {
      // GPT-5 shadow-audit regression target:
      // YouTube (down-only), mix -20 LUFS, ref -18 LUFS, target -14.
      // Both below target → 0 platform gain → projected stays at -20 / -18.
      // Pre-fix: level match forced to 0 → ref plays 2 dB louder. BUG.
      // Post-fix: residual = -20 - (-18) = -2 dB → ref matched to mix.
      const mixAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: 0, // below target, no change
        referenceLevelMatchGainDb: 0, // not reference mode
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -20,
        referenceProjectedLufs: -18,
      });
      const refAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: 0, // below target, no change
        referenceLevelMatchGainDb: -2, // raw: mix(-20) - ref(-18) = -2
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -20,
        referenceProjectedLufs: -18,
      });
      // Mix plays at -20 + 0 = -20.
      // Ref plays at -18 + 0 + (-2 residual) = -20. Invariant preserved.
      expect(-20 + mixAppliedGain).toBe(-20);
      expect(-18 + refAppliedGain).toBe(-20);
    });
  });

  describe('Both on: Apple Music full convergence', () => {
    it('works for Apple Music target (-16 LUFS)', () => {
      const mixAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -6,
        referenceLevelMatchGainDb: 0,
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -16,
        referenceProjectedLufs: -16,
      });
      const refAppliedGain = computeCombinedAppliedGainDb({
        platformNormalizationGainDb: -2,
        referenceLevelMatchGainDb: 4,
        normalizationPreviewEnabled: true,
        mixProjectedLufs: -16,
        referenceProjectedLufs: -16,
      });
      expect(-10 + mixAppliedGain).toBe(-16);
      expect(-14 + refAppliedGain).toBe(-16);
    });
  });
});
