/**
 * Pure helper for the combined gain formula when both Platform Normalization
 * and Level Match can be active at the same time.
 *
 * Bug fix (2026-04): the old App.tsx logic added platformNormGain and
 * levelMatchGain together, which double-corrected the reference when both
 * toggles were on. Repro:
 *   mix at -12 LUFS, ref at -8 LUFS, Spotify target -14 LUFS.
 *   Mix: platformGain = -2 dB → plays at -14 LUFS.
 *   Ref: platformGain = -6 dB + levelMatch (+(mix-ref) = -4 dB) = -10 dB
 *        → ref plays at -18 LUFS, 4 dB quieter than the mix.
 *
 * Fix v1: when Platform Normalization is on, we assumed it equalized both
 * tracks to the target loudness, so Level Match was forced to 0.
 *
 * Fix v2 (2026-04, GPT-5 shadow audit): that assumption is wrong for the
 * common cases where normalization does NOT fully equalize:
 *   - `down-only` platforms (YouTube / Tidal / Amazon) when both tracks
 *     are already at or below target (both get 0 gain, residual stays)
 *   - `peak-limited-upward` when either track's boost is headroom-capped
 * Repro: YouTube, mix -20 LUFS, ref -18 LUFS → both get 0 platform gain,
 * but they're still 2 dB apart. The old code then forced level match to
 * 0 and the A/B comparison was wrong by 2 dB.
 *
 * Now: callers may pass the *projected* integrated LUFS of the mix and
 * reference (what they will play as AFTER platform normalization). When
 * both are known and differ, the effective level match becomes the
 * residual delta `mixProjected - refProjected`, so the invariant holds
 * regardless of whether normalization converged. When callers can't
 * supply projected LUFS, we fall back to the v1 behavior (force to 0).
 */

export interface CombinedGainInput {
  /** Platform normalization gain applied to the currently audible source. */
  platformNormalizationGainDb: number;
  /** Level match gain (mixLufs - refLufs) when previewing the reference. */
  referenceLevelMatchGainDb: number;
  /** Whether the Platform Preview toggle is currently on. */
  normalizationPreviewEnabled: boolean;
  /**
   * Mix integrated LUFS after platform normalization has been applied.
   * Callers that don't compute this may omit it; behavior then falls back
   * to assuming full convergence (force level match to 0).
   */
  mixProjectedLufs?: number | null;
  /**
   * Reference integrated LUFS after platform normalization has been
   * applied. Same omission rules as `mixProjectedLufs`.
   */
  referenceProjectedLufs?: number | null;
}

// BUG FIX (2026-04-16, a992797): down-only platforms (YouTube/Tidal/Amazon) got 0 gain for both
// tracks but they stayed at different loudness — forcing level match to 0 broke A/B by up to several dB.
// Now computes residual delta from projected LUFS. Found by GPT-5.4 shadow audit, 2026-04-16.
export function computeEffectiveReferenceLevelMatchGainDb(
  input: Pick<
    CombinedGainInput,
    | 'referenceLevelMatchGainDb'
    | 'normalizationPreviewEnabled'
    | 'mixProjectedLufs'
    | 'referenceProjectedLufs'
  >
): number {
  if (!input.normalizationPreviewEnabled) {
    return input.referenceLevelMatchGainDb;
  }
  // When the caller supplied the projected LUFS of both the mix and the
  // reference AFTER normalization, use the residual delta so a down-only
  // platform that didn't equalize both sources still A/Bs at the same
  // loudness. The residual is only relevant when level match is actually
  // in play (we're listening to the reference). When
  // referenceLevelMatchGainDb is 0 the caller is either playing the mix
  // (no reference correction needed) or the tracks happen to be equally
  // loud already — in both cases the residual from projected LUFS would
  // either be irrelevant or near-zero anyway, and NOT applying it avoids
  // incorrectly penalizing the mix path.
  if (input.referenceLevelMatchGainDb !== 0) {
    const mix = input.mixProjectedLufs;
    const ref = input.referenceProjectedLufs;
    if (
      typeof mix === 'number' &&
      Number.isFinite(mix) &&
      typeof ref === 'number' &&
      Number.isFinite(ref)
    ) {
      return mix - ref;
    }
  }
  return 0;
}

export function computeCombinedAppliedGainDb(input: CombinedGainInput): number {
  return (
    input.platformNormalizationGainDb +
    computeEffectiveReferenceLevelMatchGainDb(input)
  );
}
