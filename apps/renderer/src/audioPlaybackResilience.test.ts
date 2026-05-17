import { describe, expect, it } from 'vitest';
import {
  getTrackSwitchFadeDurationSeconds,
  shouldAutoplayOnTransportSwitch,
  shouldAttemptPlaybackOutputRecovery,
  shouldHoldGainBeforePlayback,
  shouldRestoreAudiblePlaybackGain,
} from './audioPlaybackResilience';

describe('shouldAttemptPlaybackOutputRecovery', () => {
  it('recovers when playback is active but the Web Audio context is suspended', () => {
    expect(
      shouldAttemptPlaybackOutputRecovery({
        audioPaused: false,
        hasSource: true,
        sourceReady: true,
        contextState: 'suspended',
      })
    ).toBe(true);
  });

  it('recovers from Chromium interrupted contexts during device route changes', () => {
    expect(
      shouldAttemptPlaybackOutputRecovery({
        audioPaused: false,
        hasSource: true,
        sourceReady: true,
        contextState: 'interrupted',
      })
    ).toBe(true);
  });

  it('does not start playback when the user has paused', () => {
    expect(
      shouldAttemptPlaybackOutputRecovery({
        audioPaused: true,
        hasSource: true,
        sourceReady: true,
        contextState: 'suspended',
      })
    ).toBe(false);
  });

  it('does not try to recover a closed context in place', () => {
    expect(
      shouldAttemptPlaybackOutputRecovery({
        audioPaused: false,
        hasSource: true,
        sourceReady: true,
        contextState: 'closed',
      })
    ).toBe(false);
  });
});

describe('shouldRestoreAudiblePlaybackGain', () => {
  it('restores gain when active playback is left near silent', () => {
    expect(
      shouldRestoreAudiblePlaybackGain({
        audioPaused: false,
        currentGainLinear: 0.1,
        targetGainLinear: 1,
      })
    ).toBe(true);
  });

  it('leaves intentional mute alone', () => {
    expect(
      shouldRestoreAudiblePlaybackGain({
        audioPaused: false,
        currentGainLinear: 0,
        targetGainLinear: 0,
      })
    ).toBe(false);
  });
});

describe('shouldAutoplayOnTransportSwitch', () => {
  it('preserves autoplay when canplay already consumed the one-shot play flag but play has not settled', () => {
    expect(
      shouldAutoplayOnTransportSwitch({
        audioPaused: true,
        playOnNextLoad: false,
        playbackIntentPlaying: true,
        reactIsPlaying: false,
      })
    ).toBe(true);
  });

  it('preserves autoplay while the one-shot play-on-load flag is still armed', () => {
    expect(
      shouldAutoplayOnTransportSwitch({
        audioPaused: true,
        playOnNextLoad: true,
        playbackIntentPlaying: false,
        reactIsPlaying: false,
      })
    ).toBe(true);
  });

  it('does not autoplay when playback is intentionally stopped', () => {
    expect(
      shouldAutoplayOnTransportSwitch({
        audioPaused: true,
        playOnNextLoad: false,
        playbackIntentPlaying: false,
        reactIsPlaying: false,
      })
    ).toBe(false);
  });
});

describe('getTrackSwitchFadeDurationSeconds', () => {
  // v3.225 — track-switch crackle fix. The ramp must be long enough to mask
  // decoder cold-start jitter (which can be 30-100ms on first play) but short
  // enough to feel instantaneous to the user.
  it('uses a longer fade on first play of a newly-loaded track to mask decoder cold start', () => {
    expect(
      getTrackSwitchFadeDurationSeconds({ firstPlayOfSession: true })
    ).toBe(0.06);
  });

  it('uses a shorter fade on subsequent plays where the decoder is already warm', () => {
    expect(
      getTrackSwitchFadeDurationSeconds({ firstPlayOfSession: false })
    ).toBe(0.035);
  });

  it('returns a duration long enough to mask a cold-start click (≥30ms)', () => {
    // Empirically, decoder cold-start clicks emerge in the 15-60ms range.
    // Any fade < 30ms risks completing before the actual audio frames hit the
    // output device, leaving the click audible. Pin this invariant.
    expect(
      getTrackSwitchFadeDurationSeconds({ firstPlayOfSession: false })
    ).toBeGreaterThanOrEqual(0.03);
    expect(
      getTrackSwitchFadeDurationSeconds({ firstPlayOfSession: true })
    ).toBeGreaterThanOrEqual(0.03);
  });

  it('returns a duration short enough to feel instantaneous (≤100ms)', () => {
    // Anything > 100ms is perceived as a deliberate fade-in by the user, not
    // a click-free start. Pin the upper bound so future tweaks don't drift.
    expect(
      getTrackSwitchFadeDurationSeconds({ firstPlayOfSession: true })
    ).toBeLessThanOrEqual(0.1);
  });
});

describe('shouldHoldGainBeforePlayback', () => {
  it('pre-pins the GainNode to 0 when the target gain is audible', () => {
    expect(shouldHoldGainBeforePlayback({ targetGainLinear: 1 })).toBe(true);
    expect(shouldHoldGainBeforePlayback({ targetGainLinear: 0.25 })).toBe(true);
  });

  it('skips the pin when the user has muted (target = 0)', () => {
    // Pinning to 0 would be a no-op, and the subsequent ramp would also be a
    // no-op (0 → 0). Avoid scheduling unnecessary GainNode value changes.
    expect(shouldHoldGainBeforePlayback({ targetGainLinear: 0 })).toBe(false);
  });
});
