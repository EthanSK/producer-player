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

export interface NonEssentialAnalysisPlaybackGateInput extends PlaybackAutoplayIntentInput {
  /**
   * True when the result is already cached. Cached data is just a React read, not
   * a new decode/ffmpeg job, so playback protection must never hide it.
   */
  cachedAnalysisReady: boolean;
  /**
   * True when Ethan explicitly asked for a surface that needs the analysis now
   * (for example full-screen mastering or an audible preview transform).
   */
  explicitAnalysisRequested: boolean;
}

export function shouldDeferNonEssentialAnalysisDuringPlayback(
  input: NonEssentialAnalysisPlaybackGateInput
): boolean {
  if (input.cachedAnalysisReady || input.explicitAnalysisRequested) {
    return false;
  }

  // This gate is narrower than `shouldAutoplayOnTransportSwitch`: a queued
  // transport handoff is allowed to keep warming metadata during the load-settle
  // window, but once audio is actually moving, non-essential analysis backs off.
  return !input.audioPaused || input.reactIsPlaying;
}
