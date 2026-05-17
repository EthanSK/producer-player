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

/**
 * Returns the fade-in duration (in seconds) for a track-switch / first-play
 * event. A small ramp masks decoder cold-start jitter and prevents the audible
 * click/crackle from hard-cutting the leading audio frames to full amplitude.
 *
 * `firstPlayOfSession` = true when this is the first time the renderer has
 * played any audio since the AudioContext warmed up (or after a track switch
 * to a not-yet-decoded file). Cold starts have more decoder lag, so we use a
 * slightly longer ramp.
 */
export interface TrackSwitchFadeDurationInput {
  firstPlayOfSession: boolean;
}

export function getTrackSwitchFadeDurationSeconds(
  input: TrackSwitchFadeDurationInput
): number {
  return input.firstPlayOfSession ? 0.06 : 0.035;
}

/**
 * Whether to pre-pin the playback GainNode to 0 before starting playback of a
 * newly-loaded source. Pinning silences the leading frames so the ramp-up on
 * the `playing` event can mask the decoder cold-start click.
 *
 * Always pre-pin when target gain is audible. Skip when the user has muted
 * (target = 0) — pinning to 0 would be a no-op and the subsequent ramp would
 * also no-op.
 */
export interface PlaybackGainHoldInput {
  targetGainLinear: number;
}

export function shouldHoldGainBeforePlayback(input: PlaybackGainHoldInput): boolean {
  return input.targetGainLinear > 0;
}

/**
 * v3.226 — Codex MUST-FIX #1. Decides whether `restoreAudiblePlaybackGain`
 * should perform its ramp this call.
 *
 * The pin-at-0 + ramp-on-`playing` contract for click-free track switches
 * relies on the GainNode staying at 0 until the actual `playing` event fires.
 * Output-recovery is scheduled from `canplay` and `play` (which fire BEFORE
 * `playing` on codec-slow cold starts) — if recovery un-pins the gain in that
 * window, the leading-frame click returns.
 *
 * Returns `true` only when ALL of:
 *   - we're NOT awaiting the first `playing` event for a freshly-committed
 *     source (i.e. the cold-start hold window has already ended), AND
 *   - the underlying `shouldRestoreAudiblePlaybackGain` policy says recovery
 *     is needed (active playback left near silent, with an audible target).
 */
export interface AudiblePlaybackGainRestorationInput extends GainRestoreInput {
  awaitingFirstPlayingEvent: boolean;
}

export function shouldRunAudiblePlaybackGainRestoration(
  input: AudiblePlaybackGainRestorationInput
): boolean {
  if (input.awaitingFirstPlayingEvent) {
    return false;
  }
  return shouldRestoreAudiblePlaybackGain({
    audioPaused: input.audioPaused,
    currentGainLinear: input.currentGainLinear,
    targetGainLinear: input.targetGainLinear,
  });
}
