export type PlaybackContextState = AudioContextState | 'interrupted' | 'unknown' | 'none';

export interface PlaybackRecoveryInput {
  audioPaused: boolean;
  hasSource: boolean;
  sourceReady: boolean;
  contextState: PlaybackContextState;
}

export function shouldAttemptPlaybackOutputRecovery(input: PlaybackRecoveryInput): boolean {
  if (input.audioPaused || !input.hasSource || !input.sourceReady) {
    return false;
  }

  return input.contextState !== 'running' && input.contextState !== 'closed';
}

export interface GainRestoreInput {
  audioPaused: boolean;
  currentGainLinear: number;
  targetGainLinear: number;
}

export function shouldRestoreAudiblePlaybackGain(input: GainRestoreInput): boolean {
  if (input.audioPaused || input.targetGainLinear <= 0) {
    return false;
  }

  return input.currentGainLinear < input.targetGainLinear * 0.5;
}

export interface PlaybackAutoplayIntentInput {
  audioPaused: boolean;
  playOnNextLoad: boolean;
  playbackIntentPlaying: boolean;
  reactIsPlaying: boolean;
}

export function shouldAutoplayOnTransportSwitch(input: PlaybackAutoplayIntentInput): boolean {
  return (
    input.playOnNextLoad ||
    input.playbackIntentPlaying ||
    input.reactIsPlaying ||
    !input.audioPaused
  );
}
