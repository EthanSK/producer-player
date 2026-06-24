export const DEFAULT_LATEST_TRACK_WARMUP_URGENT_POLL_MS = 25;

export interface RunSequentialLatestTrackWarmupOptions<TEntry> {
  entries: readonly TEntry[];
  isCancelled: () => boolean;
  hasUrgentWork: (entry: TEntry, index: number) => boolean;
  wait: (ms: number) => Promise<void>;
  processEntry: (entry: TEntry, index: number) => Promise<void>;
  onUrgentPause?: () => void;
  urgentPollMs?: number;
}

export interface OrderLatestTrackWarmupEntriesOptions<TEntry> {
  visibleEntries: readonly TEntry[];
  libraryEntries: readonly TEntry[];
  getVersionId: (entry: TEntry) => string;
  detectedVersionIds?: ReadonlySet<string>;
}

/**
 * Build the latest-track warmup plan without duplicating visible entries.
 * Newly detected/latest-changed versions can be front-loaded so their measured
 * LUFS and derived platform-normalization payload are ready soon after the
 * watched folder notices the export, instead of waiting behind an unrelated
 * visible/hidden library backlog.
 */
export function orderLatestTrackWarmupEntries<TEntry>(
  options: OrderLatestTrackWarmupEntriesOptions<TEntry>
): TEntry[] {
  const seenVersionIds = new Set<string>();
  const baseEntries: TEntry[] = [];

  for (const entry of options.visibleEntries) {
    const versionId = options.getVersionId(entry);
    if (seenVersionIds.has(versionId)) continue;
    seenVersionIds.add(versionId);
    baseEntries.push(entry);
  }

  for (const entry of options.libraryEntries) {
    const versionId = options.getVersionId(entry);
    if (seenVersionIds.has(versionId)) continue;
    seenVersionIds.add(versionId);
    baseEntries.push(entry);
  }

  const detectedVersionIds = options.detectedVersionIds;
  if (!detectedVersionIds || detectedVersionIds.size === 0) {
    return baseEntries;
  }

  const detectedEntries: TEntry[] = [];
  const remainingEntries: TEntry[] = [];

  for (const entry of baseEntries) {
    if (detectedVersionIds.has(options.getVersionId(entry))) {
      detectedEntries.push(entry);
    } else {
      remainingEntries.push(entry);
    }
  }

  return [...detectedEntries, ...remainingEntries];
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

  async function pauseForUrgentWork(entry: TEntry, index: number): Promise<void> {
    // Yield once so a just-fired click/effect can enqueue USER_SELECTED work
    // before the warmup decides whether it is safe to start another track.
    await options.wait(0);

    let reportedPause = false;
    while (!options.isCancelled() && options.hasUrgentWork(entry, index)) {
      if (!reportedPause) {
        reportedPause = true;
        options.onUrgentPause?.();
      }
      await options.wait(urgentPollMs);
    }
  }

  for (let index = 0; index < options.entries.length; index += 1) {
    const entry = options.entries[index];
    await pauseForUrgentWork(entry, index);
    if (options.isCancelled()) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop -- sequential warmup is the point
    await options.processEntry(entry, index);
  }
}
