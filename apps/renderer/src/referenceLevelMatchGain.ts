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
 * Fix: when Platform Normalization is on, it already equalizes both tracks
 * to the target loudness, so Level Match becomes redundant and is forced
 * to 0. Level Match only has an effect when Platform Normalization is off.
 */

export interface CombinedGainInput {
  /** Platform normalization gain applied to the currently audible source. */
  platformNormalizationGainDb: number;
  /** Level match gain (mixLufs - refLufs) when previewing the reference. */
  referenceLevelMatchGainDb: number;
  /** Whether the Platform Preview toggle is currently on. */
  normalizationPreviewEnabled: boolean;
}

export function computeEffectiveReferenceLevelMatchGainDb(
  input: Pick<CombinedGainInput, 'referenceLevelMatchGainDb' | 'normalizationPreviewEnabled'>
): number {
  // Platform normalization already equalizes both tracks to the target
  // loudness, so level match is forced to 0 when it is on.
  return input.normalizationPreviewEnabled ? 0 : input.referenceLevelMatchGainDb;
}

export function computeCombinedAppliedGainDb(input: CombinedGainInput): number {
  return (
    input.platformNormalizationGainDb +
    computeEffectiveReferenceLevelMatchGainDb(input)
  );
}
