import { gainDbToLinear } from './platformNormalization';

export interface PlaybackGainStateInput {
  baseVolume: number;
  transformGainDb: number;
}

export interface PlaybackGainState {
  monitorVolumeLinear: number;
  transformGainLinear: number;
  audibleGainLinear: number;
}

export function computePlaybackGainState(
  input: PlaybackGainStateInput
): PlaybackGainState {
  const monitorVolumeLinear = Number.isFinite(input.baseVolume)
    ? Math.max(0, Math.min(input.baseVolume, 1))
    : 1;
  const transformGainLinear = Math.max(0, gainDbToLinear(input.transformGainDb));

  return {
    monitorVolumeLinear,
    transformGainLinear,
    audibleGainLinear: monitorVolumeLinear * transformGainLinear,
  };
}
