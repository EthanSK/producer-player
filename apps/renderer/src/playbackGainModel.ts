import { gainDbToLinear } from './platformNormalization';

export interface PlaybackGainStateInput {
  baseVolume: number;
  transformGainDb: number;
}

export interface PlaybackGainState {
  playerVolumeLinear: number;
  transformGainLinear: number;
  audibleGainLinear: number;
}

export function computePlaybackGainState(
  input: PlaybackGainStateInput
): PlaybackGainState {
  const playerVolumeLinear = Number.isFinite(input.baseVolume)
    ? Math.max(0, Math.min(input.baseVolume, 1))
    : 1;
  const transformGainLinear = Math.max(0, gainDbToLinear(input.transformGainDb));

  return {
    playerVolumeLinear,
    transformGainLinear,
    audibleGainLinear: playerVolumeLinear * transformGainLinear,
  };
}
