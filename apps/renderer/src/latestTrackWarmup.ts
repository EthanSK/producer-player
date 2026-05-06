export const DEFAULT_LATEST_TRACK_WARMUP_URGENT_POLL_MS = 25;

export interface RunSequentialLatestTrackWarmupOptions<TEntry> {
  entries: readonly TEntry[];
  isCancelled: () => boolean;
  hasUrgentWork: () => boolean;
  wait: (ms: number) => Promise<void>;
  processEntry: (entry: TEntry, index: number) => Promise<void>;
  onUrgentPause?: () => void;
  urgentPollMs?: number;
}

/**
 * Runs startup latest-track warmup top-to-bottom without flooding the shared
 * analysis queues. The runner yields before every track, waits while urgent
 * USER_SELECTED work is in flight/pending, then resumes with the next remaining
 * warmup entry.
 */
export async function runSequentialLatestTrackWarmup<TEntry>(
  options: RunSequentialLatestTrackWarmupOptions<TEntry>
): Promise<void> {
  const urgentPollMs = Math.max(
    0,
    Math.floor(options.urgentPollMs ?? DEFAULT_LATEST_TRACK_WARMUP_URGENT_POLL_MS)
  );

  async function pauseForUrgentWork(): Promise<void> {
    // Yield once so a just-fired click/effect can enqueue USER_SELECTED work
    // before the warmup decides whether it is safe to start another track.
    await options.wait(0);

    let reportedPause = false;
    while (!options.isCancelled() && options.hasUrgentWork()) {
      if (!reportedPause) {
        reportedPause = true;
        options.onUrgentPause?.();
      }
      await options.wait(urgentPollMs);
    }
  }

  for (let index = 0; index < options.entries.length; index += 1) {
    await pauseForUrgentWork();
    if (options.isCancelled()) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop -- sequential warmup is the point
    await options.processEntry(options.entries[index], index);
  }
}
