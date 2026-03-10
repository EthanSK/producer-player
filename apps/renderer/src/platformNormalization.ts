import type { AudioFileAnalysis } from '@producer-player/contracts';

export type NormalizationPlatformId = 'spotify' | 'appleMusic' | 'youtube' | 'tidal';
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

export const NORMALIZATION_PLATFORM_PROFILES: readonly NormalizationPlatformProfile[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    shortLabel: 'Spotify',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'peak-limited-upward',
    accentColor: '#1ed760',
    description: 'Approximate track-normalized Spotify “Normal” playback with peak-limited upward gain.',
  },
  {
    id: 'appleMusic',
    label: 'Apple Music',
    shortLabel: 'Apple',
    targetLufs: -16,
    truePeakCeilingDbtp: -1,
    policy: 'peak-limited-upward',
    accentColor: '#fa243c',
    description: 'Approximate Apple Music Sound Check LUFS normalization with headroom-aware upward gain.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    shortLabel: 'YouTube',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'down-only',
    accentColor: '#ff0033',
    description: 'Approximate down-only playback normalization similar to YouTube loudness penalty previewing.',
  },
  {
    id: 'tidal',
    label: 'Tidal',
    shortLabel: 'Tidal',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'down-only',
    accentColor: '#ffffff',
    description: 'Approximate down-only Tidal-style level matching for compact in-app previewing.',
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
  let explanation = `${platform.label} target ${platform.targetLufs.toFixed(0)} LUFS.`;

  if (platform.policy === 'down-only') {
    appliedGainDb = Math.min(rawGainDb, 0);
    explanation = `${platform.label} preview is down-only here: louder tracks are turned down, quieter tracks are left as-is.`;
  } else if (rawGainDb > 0) {
    if (headroomCapDb !== null) {
      const cappedPositiveGainDb = Math.max(0, headroomCapDb);
      limitedByHeadroom = cappedPositiveGainDb < rawGainDb;
      appliedGainDb = Math.min(rawGainDb, cappedPositiveGainDb);
      explanation = limitedByHeadroom
        ? `${platform.label} could raise quieter material, but this preview caps boost when the measured true peak would cross ${platform.truePeakCeilingDbtp.toFixed(0)} dBTP.`
        : `${platform.label} preview can raise quieter material until the measured true peak reaches ${platform.truePeakCeilingDbtp.toFixed(0)} dBTP.`;
    } else {
      explanation = `${platform.label} preview can raise quieter material, but the true-peak cap could not be verified for this file.`;
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
