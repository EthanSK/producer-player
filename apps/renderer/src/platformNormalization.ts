import type { AudioFileAnalysis } from '@producer-player/contracts';

export type NormalizationPlatformId = 'spotify' | 'appleMusic' | 'youtube' | 'tidal' | 'amazon';
export type NormalizationPolicy = 'peak-limited-upward' | 'down-only';

export interface NormalizationPlatformProfile {
  id: NormalizationPlatformId;
  label: string;
  shortLabel: string;
  targetLufs: number;
  truePeakCeilingDbtp: number;
  policy: NormalizationPolicy;
  accentColor: string;
  description: string;
}

export interface PlatformNormalizationPreview {
  platform: NormalizationPlatformProfile;
  rawGainDb: number | null;
  appliedGainDb: number | null;
  projectedIntegratedLufs: number | null;
  headroomCapDb: number | null;
  limitedByHeadroom: boolean;
  explanation: string;
}

/**
 * Platform normalization profiles.
 *
 * Spotify  — -14 LUFS (Normal mode), -1 dBTP. Down-only: loud tracks are
 *            turned down, quiet tracks are NOT boosted in the default mode.
 *
 * Apple Music — Sound Check normalizes to -16 LUFS (per AES TD1008), -1 dBTP.
 *              Adjusts both up and down with headroom-aware gain limiting.
 *
 * YouTube — -14 LUFS, -1 dBTP, down-only. Loud tracks are turned down;
 *           quiet tracks are not boosted.
 *
 * Tidal   — -14 LUFS, -1 dBTP, down-only. Does not raise the level of
 *           music quieter than -14 LUFS.
 *
 * Amazon Music — -14 LUFS, -2 dBTP, down-only. Loud tracks are turned down.
 */
export const NORMALIZATION_PLATFORM_PROFILES: readonly NormalizationPlatformProfile[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    shortLabel: 'Spotify',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'down-only',
    accentColor: '#1ed760',
    description: 'Spotify turns down loud tracks to -14 LUFS but does not boost quiet ones in normal mode.',
  },
  {
    id: 'appleMusic',
    label: 'Apple Music',
    shortLabel: 'Apple',
    targetLufs: -16,
    truePeakCeilingDbtp: -1,
    policy: 'peak-limited-upward',
    accentColor: '#fa243c',
    description: 'Apple Music Sound Check normalizes up and down to -16 LUFS, capped at -1 dBTP.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    shortLabel: 'YouTube',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'down-only',
    accentColor: '#ff0033',
    description: 'YouTube turns down loud tracks to -14 LUFS but does not boost quiet ones.',
  },
  {
    id: 'tidal',
    label: 'Tidal',
    shortLabel: 'Tidal',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'down-only',
    accentColor: '#ffffff',
    description: 'Tidal turns down loud tracks to -14 LUFS. Quiet tracks stay at their original level.',
  },
  {
    id: 'amazon',
    label: 'Amazon Music',
    shortLabel: 'Amazon',
    targetLufs: -14,
    truePeakCeilingDbtp: -2,
    policy: 'down-only',
    accentColor: '#25d1da',
    description: 'Amazon Music targets -14 LUFS with a stricter -2 dBTP ceiling. Loud tracks are turned down.',
  },
] as const;

export function getNormalizationPlatformProfile(
  platformId: NormalizationPlatformId
): NormalizationPlatformProfile {
  return (
    NORMALIZATION_PLATFORM_PROFILES.find((platform) => platform.id === platformId) ??
    NORMALIZATION_PLATFORM_PROFILES[0]
  );
}

export function gainDbToLinear(gainDb: number): number {
  if (!Number.isFinite(gainDb)) {
    return 1;
  }

  return 10 ** (gainDb / 20);
}

function roundDb(level: number): number {
  return Math.round(level * 10) / 10;
}

export function computePlatformNormalizationPreview(
  analysis: AudioFileAnalysis | null,
  platform: NormalizationPlatformProfile
): PlatformNormalizationPreview | null {
  if (!analysis || analysis.integratedLufs === null || !Number.isFinite(analysis.integratedLufs)) {
    return null;
  }

  const rawGainDb = platform.targetLufs - analysis.integratedLufs;
  const headroomCapDb =
    analysis.truePeakDbfs === null || !Number.isFinite(analysis.truePeakDbfs)
      ? null
      : platform.truePeakCeilingDbtp - analysis.truePeakDbfs;

  let appliedGainDb = rawGainDb;
  let limitedByHeadroom = false;
  let explanation = `${platform.label} targets ${platform.targetLufs.toFixed(0)} LUFS.`;

  if (platform.policy === 'down-only') {
    appliedGainDb = Math.min(rawGainDb, 0);
    explanation = rawGainDb >= 0
      ? `${platform.label} only turns down loud tracks — yours is at or below the target, so no change.`
      : `${platform.label} will turn this down by ${Math.abs(roundDb(rawGainDb)).toFixed(1)} dB to hit ${platform.targetLufs.toFixed(0)} LUFS.`;
  } else if (rawGainDb > 0) {
    if (headroomCapDb !== null) {
      const cappedPositiveGainDb = Math.max(0, headroomCapDb);
      limitedByHeadroom = cappedPositiveGainDb < rawGainDb;
      appliedGainDb = Math.min(rawGainDb, cappedPositiveGainDb);
      explanation = limitedByHeadroom
        ? `${platform.label} would boost by ${rawGainDb.toFixed(1)} dB, but true peak headroom caps it at ${appliedGainDb.toFixed(1)} dB (${platform.truePeakCeilingDbtp.toFixed(0)} dBTP ceiling).`
        : `${platform.label} boosts this by ${appliedGainDb.toFixed(1)} dB — enough headroom to stay under ${platform.truePeakCeilingDbtp.toFixed(0)} dBTP.`;
    } else {
      explanation = `${platform.label} would boost this track, but true peak data is not available to verify the headroom cap.`;
    }
  }

  return {
    platform,
    rawGainDb: roundDb(rawGainDb),
    appliedGainDb: roundDb(appliedGainDb),
    projectedIntegratedLufs: roundDb(analysis.integratedLufs + appliedGainDb),
    headroomCapDb: headroomCapDb === null ? null : roundDb(headroomCapDb),
    limitedByHeadroom,
    explanation,
  };
}
