import type { SongVersion } from '@producer-player/contracts';

type PlaybackSourceCacheVersion = Pick<
  SongVersion,
  'id' | 'filePath' | 'sizeBytes' | 'modifiedAt'
>;

/**
 * Playback source preparation can be expensive for formats that need the local
 * WAV cache, and even the cheap direct-file path still crosses Electron IPC.
 * Key by every field that can change the resolved playable source so a
 * rewritten export at the same path gets a fresh resolve.
 */
export function buildPlaybackSourceCacheKey(version: PlaybackSourceCacheVersion): string {
  return [
    version.id,
    version.filePath,
    version.sizeBytes,
    version.modifiedAt,
  ].join('::');
}

/**
 * Extend the "no background work" deadline without ever shortening an existing
 * reservation. Autoplay handoff and selected-track settle windows can overlap;
 * the most conservative deadline is the only one that matters.
 */
export function extendPlaybackSettleUntil(
  currentPausedUntilMs: number,
  nowMs: number,
  durationMs: number
): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return currentPausedUntilMs;
  }

  return Math.max(currentPausedUntilMs, nowMs + Math.floor(durationMs));
}

/**
 * Avoid assigning HTMLMediaElement.currentTime when the requested position is
 * already effectively current. Chromium treats even an identical assignment
 * as a new seek on some WAV sources, producing a waiting/canplay/playing cycle.
 */
export function shouldApplyPlaybackSeek(options: {
  currentTimeSeconds: number;
  targetTimeSeconds: number;
  epsilonSeconds?: number;
}): boolean {
  if (
    !Number.isFinite(options.currentTimeSeconds) ||
    !Number.isFinite(options.targetTimeSeconds)
  ) {
    return false;
  }

  const epsilonSeconds = Number.isFinite(options.epsilonSeconds)
    ? Math.max(0, options.epsilonSeconds ?? 0)
    : 0.025;

  return Math.abs(options.targetTimeSeconds - options.currentTimeSeconds) > epsilonSeconds;
}

/**
 * Checklist typing normally rewinds by three seconds so the producer can
 * immediately re-hear what prompted a note. During an album handoff, though,
 * that same behavior clamps to 0:00 and restarts the new song inside its first
 * protected seconds. Capture the timestamp but leave the audible transport
 * alone until the handoff settle window has closed.
 */
export function shouldSynchronizeChecklistTypingSeek(options: {
  currentTimeSeconds: number;
  targetTimeSeconds: number;
  playbackSettling: boolean;
}): boolean {
  return (
    !options.playbackSettling &&
    shouldApplyPlaybackSeek({
      currentTimeSeconds: options.currentTimeSeconds,
      targetTimeSeconds: options.targetTimeSeconds,
    })
  );
}

export function getNextPlaybackQueueVersion<TVersion>(
  queue: readonly TVersion[],
  currentIndex: number,
  options: { wrap: boolean }
): TVersion | null {
  if (queue.length === 0) {
    return null;
  }

  const baseIndex =
    currentIndex >= 0 && currentIndex < queue.length
      ? currentIndex
      : -1;
  let nextIndex = baseIndex + 1;

  if (nextIndex >= queue.length) {
    if (!options.wrap) {
      return null;
    }
    nextIndex = 0;
  }

  return queue[nextIndex] ?? null;
}

/**
 * Decide when Chromium may begin decoding the next album track.
 *
 * Short interludes still preload near their start so gapless handoff remains
 * possible. Long songs wait until the closing lead window; decoding another
 * full-resolution WAV during the first second of the current song is all cost
 * and no benefit, and can contend with the audible decoder at exactly the
 * worst moment.
 */
export function getAutoplayMediaPreloadDelayMs(options: {
  currentTimeSeconds: number;
  durationSeconds: number;
  settleDelayMs: number;
  leadTimeSeconds?: number;
  shortTrackMaxDurationSeconds?: number;
}): number | null {
  const durationSeconds = Number.isFinite(options.durationSeconds)
    ? Math.max(0, options.durationSeconds)
    : 0;
  if (durationSeconds <= 0) {
    return null;
  }

  const currentTimeSeconds = Number.isFinite(options.currentTimeSeconds)
    ? Math.max(0, options.currentTimeSeconds)
    : 0;
  const settleDelayMs = Number.isFinite(options.settleDelayMs)
    ? Math.max(0, Math.floor(options.settleDelayMs))
    : 0;
  const leadTimeSeconds = Number.isFinite(options.leadTimeSeconds)
    ? Math.max(0, options.leadTimeSeconds ?? 0)
    : 15;
  const shortTrackMaxDurationSeconds = Number.isFinite(
    options.shortTrackMaxDurationSeconds
  )
    ? Math.max(0, options.shortTrackMaxDurationSeconds ?? 0)
    : 30;

  if (durationSeconds <= shortTrackMaxDurationSeconds) {
    return settleDelayMs;
  }

  const remainingSeconds = Math.max(0, durationSeconds - currentTimeSeconds);
  const untilLeadWindowMs = Math.max(
    0,
    Math.floor((remainingSeconds - leadTimeSeconds) * 1000)
  );
  return Math.max(settleDelayMs, untilLeadWindowMs);
}
