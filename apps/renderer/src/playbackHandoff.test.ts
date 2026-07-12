import { describe, expect, it } from 'vitest';
import {
  buildPlaybackSourceCacheKey,
  extendPlaybackSettleUntil,
  getAutoplayMediaPreloadDelayMs,
  getNextPlaybackQueueVersion,
  shouldApplyPlaybackSeek,
  shouldSynchronizeChecklistTypingSeek,
} from './playbackHandoff';

describe('buildPlaybackSourceCacheKey', () => {
  it('changes when the same export path is rewritten', () => {
    const base = {
      id: 'song-a-v1',
      filePath: '/album/Song A v1.aiff',
      sizeBytes: 1_024,
      modifiedAt: '2026-06-09T20:00:00.000Z',
    };

    expect(buildPlaybackSourceCacheKey(base)).not.toBe(
      buildPlaybackSourceCacheKey({
        ...base,
        sizeBytes: 2_048,
        modifiedAt: '2026-06-09T20:05:00.000Z',
      })
    );
  });
});

describe('extendPlaybackSettleUntil', () => {
  it('extends the settle window without shortening an existing longer handoff', () => {
    expect(extendPlaybackSettleUntil(1_000, 2_000, 1_500)).toBe(3_500);
    expect(extendPlaybackSettleUntil(5_000, 2_000, 1_500)).toBe(5_000);
  });

  it('ignores invalid or empty durations', () => {
    expect(extendPlaybackSettleUntil(1_000, 2_000, 0)).toBe(1_000);
    expect(extendPlaybackSettleUntil(1_000, 2_000, Number.NaN)).toBe(1_000);
  });
});

describe('shouldApplyPlaybackSeek', () => {
  it('rejects duplicate currentTime assignments that would retrigger media waiting', () => {
    expect(
      shouldApplyPlaybackSeek({
        currentTimeSeconds: 0,
        targetTimeSeconds: 0,
      })
    ).toBe(false);
    expect(
      shouldApplyPlaybackSeek({
        currentTimeSeconds: 12.5,
        targetTimeSeconds: 12.51,
      })
    ).toBe(false);
  });

  it('allows a real user seek', () => {
    expect(
      shouldApplyPlaybackSeek({
        currentTimeSeconds: 12.5,
        targetTimeSeconds: 9.5,
      })
    ).toBe(true);
  });
});

describe('shouldSynchronizeChecklistTypingSeek', () => {
  it('keeps checklist typing from restarting a newly handed-off song', () => {
    expect(
      shouldSynchronizeChecklistTypingSeek({
        currentTimeSeconds: 2.45,
        targetTimeSeconds: 0,
        playbackSettling: true,
      })
    ).toBe(false);
  });

  it('preserves the intentional three-second rewind after playback settles', () => {
    expect(
      shouldSynchronizeChecklistTypingSeek({
        currentTimeSeconds: 12,
        targetTimeSeconds: 9,
        playbackSettling: false,
      })
    ).toBe(true);
  });
});

describe('getNextPlaybackQueueVersion', () => {
  it('returns the next queue entry without wrapping by default', () => {
    expect(getNextPlaybackQueueVersion(['a', 'b', 'c'], 1, { wrap: false })).toBe('c');
    expect(getNextPlaybackQueueVersion(['a', 'b', 'c'], 2, { wrap: false })).toBeNull();
  });

  it('wraps to the first queue entry when repeat-all needs a next source', () => {
    expect(getNextPlaybackQueueVersion(['a', 'b', 'c'], 2, { wrap: true })).toBe('a');
  });

  it('primes from the start when no current queue entry is selected yet', () => {
    expect(getNextPlaybackQueueVersion(['a', 'b'], -1, { wrap: false })).toBe('a');
  });
});

describe('getAutoplayMediaPreloadDelayMs', () => {
  it('keeps next-track decoding out of the opening seconds of a long song', () => {
    expect(
      getAutoplayMediaPreloadDelayMs({
        currentTimeSeconds: 1,
        durationSeconds: 201,
        settleDelayMs: 0,
      })
    ).toBe(185_000);
  });

  it('starts when a long song reaches the closing lead window', () => {
    expect(
      getAutoplayMediaPreloadDelayMs({
        currentTimeSeconds: 186,
        durationSeconds: 201,
        settleDelayMs: 0,
      })
    ).toBe(0);
  });

  it('preserves early preloading for short interludes', () => {
    expect(
      getAutoplayMediaPreloadDelayMs({
        currentTimeSeconds: 1,
        durationSeconds: 12,
        settleDelayMs: 900,
      })
    ).toBe(900);
  });

  it('waits for duration metadata instead of guessing that a track is short', () => {
    expect(
      getAutoplayMediaPreloadDelayMs({
        currentTimeSeconds: 0,
        durationSeconds: 0,
        settleDelayMs: 900,
      })
    ).toBeNull();
  });
});
