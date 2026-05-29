import type { MasteringCacheEntry, SongVersion } from '@producer-player/contracts';

// v3.269 — Bumped from 1 → 2 when bitDepth + sampleFormat were added to
// AgentStaticAnalysis (Ethan voice 7201, 2026-05-29). Old v1 entries lack
// those fields, so we want isMasteringCacheEntryFresh to treat them as
// stale and trigger a reanalysis with the extended ffprobe pass. Without
// the bump, the Inspector version-history row would render "48 kHz" with
// no bit-depth segment for any track analyzed before the upgrade until
// the user happened to re-trigger analysis manually.
export const MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION = 2;

export const MASTERING_SESSION_CACHE_DISCLOSURE_REMINDER =
  'If you reference cached track analyses, explicitly tell the user those values came from this session\'s in-memory mastering analysis cache.';

export function parseVersionModifiedAtMs(version: SongVersion): number {
  const parsed = Number(new Date(version.modifiedAt).getTime());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

export function buildMasteringCacheKey(version: SongVersion): string {
  // Strict track/version identity for the shared in-session analysis cache.
  // Filename alone is not enough: a same-name replacement should invalidate
  // when the scanner observes a different path/size/mtime tuple, but repeated
  // A↔B↔A switching inside one unchanged session must keep hitting this exact
  // key and therefore reuse completed cache entries / in-flight promises.
  return [
    MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION,
    version.filePath,
    version.sizeBytes,
    parseVersionModifiedAtMs(version),
  ].join('::');
}

export function isMasteringCacheEntryFresh(
  entry: MasteringCacheEntry | undefined,
  version: SongVersion
): boolean {
  if (!entry) {
    return false;
  }

  return (
    entry.schemaVersion === MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION &&
    entry.cacheKey === buildMasteringCacheKey(version)
  );
}
