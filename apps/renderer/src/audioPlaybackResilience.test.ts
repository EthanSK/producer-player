import { describe, expect, it } from 'vitest';
import {
  shouldAutoplayOnTransportSwitch,
  shouldAttemptPlaybackOutputRecovery,
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
