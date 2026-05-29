import type { MasteringCacheEntry, SongVersion } from '@producer-player/contracts';

// v3.269 — Bumped from 1 → 2 when bitDepth + sampleFormat were added to
// AgentStaticAnalysis (Ethan voice 7201, 2026-05-29). Old v1 entries lack
// those fields, so we want isMasteringCacheEntryFresh to treat them as
// stale and trigger a reanalysis with the extended ffprobe pass. Without
// the bump, the Inspector version-history row would render "48 kHz" with
// no bit-depth segment for any track analyzed before the upgrade until
// the user happened to re-trigger analysis manually.
export const MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION = 2;

// v3.270 — File extensions whose audio streams are unambiguously lossless
// PCM (or near-PCM). When we encounter a schema-version-2 cache entry with
// `bitDepth === null`, we use the file extension as a corroborating signal
// to decide whether the null is legitimate (lossy source — no PCM bit
// depth) or stale (entry was written by an in-flight install where the
// ffprobe upgrade hadn't materialised yet for this code path). A `.wav`
// with bitDepth=null is almost certainly the latter and should re-analyse;
// a `.mp3` with bitDepth=null is the former and stays fresh. Ethan voice
// 7213 (2026-05-29): "Maybe use the file format. Maybe it's something."
const LOSSLESS_AUDIO_EXTENSIONS = new Set([
  'wav',
  'aiff',
  'aif',
  'aifc',
  'flac',
  'alac',
]);

// v3.270 — ffprobe `sample_fmt` strings that signal a PCM stream. Strip a
// trailing `p` (planar variant) before comparing so `s16p`/`fltp` match
// `s16`/`flt`. If we see any of these, bit depth was definitely available
// from ffprobe and a null `bitDepth` means the cache entry predates the
// v3.269 ffprobe upgrade — force re-analysis. If sampleFormat is also
// null (very old entries, or non-standard streams) we fall back to the
// file-extension hint above.
const PCM_SAMPLE_FORMATS = new Set([
  's16',
  's24',
  's32',
  's64',
  'u8',
  'flt',
  'dbl',
]);

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

  if (entry.schemaVersion !== MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION) {
    return false;
  }

  if (entry.cacheKey !== buildMasteringCacheKey(version)) {
    return false;
  }

  // v3.270 — Tighten freshness so entries with a missing `bitDepth` on a
  // KNOWN-lossless source trigger re-analysis (Ethan voice 7213,
  // 2026-05-29). The trigger case: the user installed v3.269 mid-session;
  // some background analyses had already written cache entries at the new
  // schemaVersion=2 BEFORE the rebuilt ffprobe pass produced bitDepth, so
  // schemaVersion alone was a false-positive for "this entry has bit
  // depth". The Inspector then trusted the stale entry and never
  // re-analysed — Ethan's real songs on Mini showed "Sample rate: 48 kHz"
  // with no bit-depth segment, even though the feature shipped.
  //
  // Decision tree when bitDepth is null:
  //   1. sampleFormat is a PCM string (s16/s24/s32/flt/dbl/...) → re-analyse.
  //      bitDepth SHOULD have been set by the v3.269 derivation logic; a null
  //      here means the entry was written by an older path.
  //   2. sampleFormat is null AND the file extension is a known lossless
  //      container (.wav/.aiff/.flac/.alac) → re-analyse. Same reasoning,
  //      using the extension as a fallback corroborating signal per Ethan's
  //      "maybe use the file format" hint.
  //   3. Otherwise (sampleFormat indicates lossy, or extension is .mp3/.m4a
  //      and sampleFormat is null) → trust the null. It's a legitimate
  //      lossy source where PCM bit depth doesn't map.
  //
  // We don't store codecName directly on the cache entry; sampleFormat +
  // extension is enough to disambiguate in practice without changing the
  // contract shape again.
  // Defensive: if the cache entry omits staticAnalysis entirely (shouldn't
  // happen at schema=2 but the tests use bare stubs and runtime drift is
  // possible), treat it as stale rather than crashing.
  if (!entry.staticAnalysis) {
    return false;
  }

  if (entry.staticAnalysis.bitDepth === null || entry.staticAnalysis.bitDepth === undefined) {
    const sampleFormatLower = entry.staticAnalysis.sampleFormat?.toLowerCase().replace(/p$/, '') ?? null;

    if (sampleFormatLower !== null && PCM_SAMPLE_FORMATS.has(sampleFormatLower)) {
      // PCM stream with no bit depth on a schema-2 entry → definitely stale.
      return false;
    }

    if (sampleFormatLower === null) {
      // No sampleFormat to disambiguate — fall back to the file extension
      // of the cached entry. If it's a lossless container, re-analyse;
      // otherwise trust the null (true lossy source).
      const extensionLower = entry.extension?.toLowerCase() ?? null;
      if (extensionLower !== null && LOSSLESS_AUDIO_EXTENSIONS.has(extensionLower)) {
        return false;
      }
    }
  }

  return true;
}
