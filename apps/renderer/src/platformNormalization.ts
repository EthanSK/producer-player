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
 * Platform normalization profiles — verified against authoritative sources.
 *
 * Sources (verified March 2026):
 *
 * Spotify  — -14 LUFS integrated (Normal mode), -1 dBTP true peak ceiling.
 *            Both up and down: positive gain applied to quiet tracks, capped
 *            so true peak stays at or below -1 dBTP. No limiter in Normal mode.
 *            Ref: https://support.spotify.com/us/artists/article/loudness-normalization/
 *
 * Apple Music — Sound Check normalizes to -16 LUFS integrated, -1 dBTP.
 *              Adjusts both up and down. Quiet tracks are raised only as far
 *              as peak headroom allows (no limiter, no compression).
 *              Ref: https://www.production-expert.com/...apple-choose-16lufs...
 *
 * YouTube — -14 LUFS, -1 dBTP, down-only. Loud tracks are turned down;
 *           quiet tracks play at their original level.
 *           Ref: https://www.meterplugs.com/blog/2019/09/18/youtube-changes-loudness-reference-to-14-lufs.html
 *
 * Tidal   — -14 LUFS, -1 dBTP, down-only. Tidal does not raise the level
 *           of music quieter than -14 LUFS.
 *           Ref: https://productionadvice.co.uk/tidal-loudness/
 *
 * Amazon Music — -14 LUFS, -2 dBTP, down-only. Loud tracks are turned down.
 *               Amazon recommends the stricter -2 dBTP ceiling.
 */
export const NORMALIZATION_PLATFORM_PROFILES: readonly NormalizationPlatformProfile[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    shortLabel: 'Spotify',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'peak-limited-upward',
    accentColor: '#1ed760',
    description: 'Spotify normalizes to -14 LUFS. If your track is louder, Spotify turns it down. If quieter, Spotify boosts it — but only as far as the -1 dBTP peak ceiling allows, so your peaks never clip.',
  },
  {
    id: 'appleMusic',
    label: 'Apple Music',
    shortLabel: 'Apple',
    targetLufs: -16,
    truePeakCeilingDbtp: -1,
    policy: 'peak-limited-upward',
    accentColor: '#ff4e6b',
    description: 'Apple Music Sound Check targets -16 LUFS — quieter than Spotify, which preserves more dynamics. Both boosts and cuts are applied, but boosts are limited by the -1 dBTP peak ceiling.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    shortLabel: 'YouTube',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'down-only',
    accentColor: '#ff0033',
    description: 'YouTube targets -14 LUFS but only turns loud tracks down. If your track is quieter than -14 LUFS, YouTube leaves it at its original volume — it never boosts.',
  },
  {
    id: 'tidal',
    label: 'Tidal',
    shortLabel: 'Tidal',
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    policy: 'down-only',
    accentColor: '#ffffff',
    description: 'Tidal targets -14 LUFS and only turns loud tracks down. Quiet tracks stay at their original level — Tidal never boosts playback volume.',
  },
  {
    id: 'amazon',
    label: 'Amazon Music',
    shortLabel: 'Amazon',
    targetLufs: -14,
    truePeakCeilingDbtp: -2,
    policy: 'down-only',
    accentColor: '#25d1da',
    description: 'Amazon Music targets -14 LUFS with a stricter -2 dBTP peak ceiling. Only turns loud tracks down. The lower peak ceiling means you should leave extra headroom when mastering for Amazon.',
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
      ? `${platform.label} only turns down loud tracks \u2014 yours is at or below the target, so no change.`
      : `${platform.label} will turn this track down by ${Math.abs(roundDb(rawGainDb)).toFixed(1)} dB to hit ${platform.targetLufs.toFixed(0)} LUFS.`;
  } else if (rawGainDb > 0) {
    if (headroomCapDb !== null) {
      const cappedPositiveGainDb = Math.max(0, headroomCapDb);
      limitedByHeadroom = cappedPositiveGainDb < rawGainDb;
      appliedGainDb = Math.min(rawGainDb, cappedPositiveGainDb);
      explanation = limitedByHeadroom
        ? `${platform.label} would boost by ${rawGainDb.toFixed(1)} dB, but true peak headroom limits the boost to ${appliedGainDb.toFixed(1)} dB (capped at ${platform.truePeakCeilingDbtp.toFixed(0)} dBTP).`
        : `${platform.label} boosts this track by ${appliedGainDb.toFixed(1)} dB \u2014 enough headroom to stay under ${platform.truePeakCeilingDbtp.toFixed(0)} dBTP.`;
    } else {
      // BUG FIX (2026-04-16, a992797): returned appliedGainDb = rawGainDb despite missing truePeak,
      // overstating confidence. Now nulls applied/projected to surface uncertainty.
      // Found by GPT-5.4 shadow audit, 2026-04-16.
      explanation = `${platform.label} would boost this track, but true peak data is not available to verify the headroom cap.`;
      return {
        platform,
        rawGainDb: roundDb(rawGainDb),
        appliedGainDb: null,
        projectedIntegratedLufs: null,
        headroomCapDb: null,
        limitedByHeadroom: false,
        explanation,
      };
    }
  } else {
    // BUG FIX (2026-04-16, a992797): peak-limited-upward platforms with loud tracks showed a
    // generic explanation — user couldn't tell the platform was turning them down.
    // Found by GPT-5.4 shadow audit, 2026-04-16.
    appliedGainDb = rawGainDb;
    explanation = `${platform.label} will turn this track down by ${Math.abs(roundDb(rawGainDb)).toFixed(1)} dB to hit ${platform.targetLufs.toFixed(0)} LUFS.`;
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
