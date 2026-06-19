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
  // v3.272 — REVERTED to schema + cacheKey only (Ethan voice 7225, 2026-05-30).
  //
  // v3.270 tightened this predicate to also INVALIDATE entries with
  // `bitDepth === null` on lossless sources. That worked for the bit-depth
  // gap but caused a much louder regression: every main-list-row in
  // Ethan's library/album view flipped to "Loading…" because the same
  // freshness check gates the LUFS display at line ~18514 of App.tsx —
  // hiding a perfectly-valid cached `integratedLufs` just because the
  // entry lacked a bit-depth field. With ~71 entries needing re-analysis
  // in parallel, the LUFS column appeared stuck on loading indefinitely
  // (and would re-loop forever if ffprobe ever returned bitDepth=null
  // for one of them).
  //
  // Fix: separate the two concerns.
  //   * `isMasteringCacheEntryFresh`  → can I trust this entry's LUFS /
  //     sample-rate / true-peak / normalization? (this function)
  //   * `isMasteringCacheEntryMissingBitDepth` (new) → does this entry
  //     ALSO need a background bit-depth refresh? (used only at dispatch
  //     sites — never gates a read)
  //
  // Result: cached LUFS / sample-rate render INSTANTLY from disk-cache;
  // bit-depth is filled in by a one-shot background re-analysis when
  // applicable; no infinite re-analysis loop even if the re-analysis
  // also returns null bitDepth.
  if (!entry) {
    return false;
  }

  if (entry.schemaVersion !== MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION) {
    return false;
  }

  if (entry.cacheKey !== buildMasteringCacheKey(version)) {
    return false;
  }

  // Defensive: if the cache entry omits staticAnalysis entirely (shouldn't
  // happen at schema=2 but the tests use bare stubs and runtime drift is
  // possible), treat it as stale rather than crashing.
  if (!entry.staticAnalysis) {
    return false;
  }

  return true;
}

// v3.272 — Companion predicate that tells the renderer "the cached entry
// is fresh enough to show, BUT it's missing a bit-depth that we'd expect
// for this source type, so kick off a background re-analysis to fill it
// in". This is exactly the v3.270 logic, but extracted to a separate
// function so it can drive DISPATCH without gating DISPLAY.
//
// Returns true when:
//   * Entry is fresh (must satisfy isMasteringCacheEntryFresh first), AND
//   * bitDepth is null/undefined, AND
//   * sampleFormat indicates PCM (s16/s24/s32/flt/dbl/…) OR
//     sampleFormat is also null AND extension is a known lossless
//     container (.wav/.aiff/.flac/.alac).
//
// Returns false when the null is legitimate (lossy source — mp3/aac/etc).
// Returns false when bitDepth is a concrete number (no refresh needed).
// Returns false when the entry isn't fresh anyway (a full re-analysis is
// already implied by the freshness miss).
export function isMasteringCacheEntryMissingBitDepth(
  entry: MasteringCacheEntry | undefined,
  version: SongVersion
): boolean {
  if (!isMasteringCacheEntryFresh(entry, version)) {
    return false;
  }

  // isMasteringCacheEntryFresh guarantees entry + staticAnalysis are non-null,
  // but TypeScript can't narrow through the boolean return — re-check defensively.
  if (!entry || !entry.staticAnalysis) {
    return false;
  }

  const bitDepth = entry.staticAnalysis.bitDepth;
  if (bitDepth !== null && bitDepth !== undefined) {
    return false;
  }

  const sampleFormatLower =
    entry.staticAnalysis.sampleFormat?.toLowerCase().replace(/p$/, '') ?? null;

  if (sampleFormatLower !== null && PCM_SAMPLE_FORMATS.has(sampleFormatLower)) {
    // PCM stream with no bit depth on a schema-2 entry → missing.
    return true;
  }

  if (sampleFormatLower === null) {
    // No sampleFormat to disambiguate — fall back to file extension.
    const extensionLower = entry.extension?.toLowerCase() ?? null;
    if (extensionLower !== null && LOSSLESS_AUDIO_EXTENSIONS.has(extensionLower)) {
      return true;
    }
  }

  // sampleFormat indicates a true lossy source (no PCM bit depth), or the
  // null is legitimate for the source type.
  return false;
}

export function isMasteringCacheEntryMissingBpm(
  entry: MasteringCacheEntry | undefined,
  version: SongVersion
): boolean {
  if (!isMasteringCacheEntryFresh(entry, version)) {
    return false;
  }

  if (!entry || !entry.staticAnalysis) {
    return false;
  }

  // BPM has a three-state cache contract:
  //   undefined → legacy entry, BPM probing did not exist yet
  //   null      → the metadata-only probe ran and found no usable tempo tag
  //   number    → embedded tempo tag found
  //
  // Only `undefined` should trigger background work. `null` is final for this
  // cache key; otherwise albums with no BPM tags would probe forever.
  return entry.staticAnalysis.bpm === undefined;
}
