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
