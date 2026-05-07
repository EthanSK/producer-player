export const UNBOUNDED_ANALYSIS_CACHE_LIMIT = Number.POSITIVE_INFINITY;

/**
 * Store processed analysis data in renderer memory under a stable cache key.
 *
 * Producer Player analysis outputs are compact summaries (scalars + small
 * arrays), not full decoded audio buffers. Ethan's product invariant is that a
 * processed track/version should stay hot for the rest of the app session and
 * should never be reprocessed unless the cache key changes because the file
 * identity actually changed. For that reason the default cache limit is
 * intentionally unbounded.
 *
 * Tests can pass a finite `limit` to exercise the old LRU behaviour without
 * reintroducing eviction for production analysis caches.
 */
export function cacheAnalysisValue<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  limit: number = UNBOUNDED_ANALYSIS_CACHE_LIMIT
): void {
  if (!key) {
    return;
  }

  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);

  if (!Number.isFinite(limit)) {
    return;
  }

  const normalizedLimit = Math.max(0, Math.floor(limit));
  while (cache.size > normalizedLimit) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}
