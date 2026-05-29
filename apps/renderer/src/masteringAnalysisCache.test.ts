import { describe, expect, it } from 'vitest';
import type { MasteringCacheEntry, SongVersion } from '@producer-player/contracts';
import {
  MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION,
  buildMasteringCacheKey,
  isMasteringCacheEntryFresh,
  parseVersionModifiedAtMs,
} from './masteringAnalysisCache';

function makeVersion(overrides: Partial<SongVersion> = {}): SongVersion {
  return {
    id: 'version-1',
    songId: 'song-1',
    folderId: 'folder-1',
    filePath: '/mixes/Alpha v1.wav',
    fileName: 'Alpha v1.wav',
    extension: 'wav',
    modifiedAt: '2026-05-07T00:00:00.000Z',
    sizeBytes: 12345,
    durationMs: 120_000,
    isActive: true,
    ...overrides,
  };
}

// v3.270 — Helper for constructing a minimal MasteringCacheEntry suitable
// for freshness tests. Only the fields isMasteringCacheEntryFresh actually
// reads are populated; the rest are filled with sensible defaults so we
// don't have to spell out every contract field per test case.
function makeEntry(
  version: SongVersion,
  staticAnalysisOverrides: Partial<MasteringCacheEntry['staticAnalysis']> = {},
  entryOverrides: Partial<MasteringCacheEntry> = {}
): MasteringCacheEntry {
  return {
    schemaVersion: MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION,
    cacheKey: buildMasteringCacheKey(version),
    source: 'selected-track',
    analyzedAt: '2026-05-29T00:00:00.000Z',
    songId: version.songId,
    songTitle: 'Alpha',
    folderId: version.folderId,
    versionId: version.id,
    filePath: version.filePath,
    fileName: version.fileName,
    extension: version.extension,
    durationSeconds: 120,
    fileSizeBytes: version.sizeBytes,
    fileModifiedAtMs: Date.parse(version.modifiedAt),
    measuredAnalysis: {
      filePath: version.filePath,
      measuredWith: 'ffmpeg-ebur128-volumedetect',
      integratedLufs: -14,
      loudnessRangeLufs: 6,
      truePeakDbfs: -1,
      samplePeakDbfs: -1.2,
      meanVolumeDbfs: -18,
      maxMomentaryLufs: -10,
      maxShortTermLufs: -12,
      sampleRateHz: 48000,
      bitDepth: 24,
      sampleFormat: 's32',
    },
    staticAnalysis: {
      integratedLufs: -14,
      loudnessRangeLufs: 6,
      truePeakDbfs: -1,
      samplePeakDbfs: -1.2,
      meanVolumeDbfs: -18,
      maxMomentaryLufs: -10,
      maxShortTermLufs: -12,
      sampleRateHz: 48000,
      bitDepth: 24,
      sampleFormat: 's32',
      ...staticAnalysisOverrides,
    },
    platformNormalization: { platforms: [] },
    ...entryOverrides,
  };
}

describe('mastering analysis session cache keys', () => {
  it('uses schema + file path + size + mtime as the stale-safety key', () => {
    const base = makeVersion();
    const baseKey = buildMasteringCacheKey(base);

    expect(baseKey).toBe(
      `${MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION}::/mixes/Alpha v1.wav::12345::${Date.parse(
        '2026-05-07T00:00:00.000Z'
      )}`
    );

    expect(buildMasteringCacheKey(makeVersion({ filePath: '/mixes/renamed/Alpha v1.wav' }))).not.toBe(
      baseKey
    );
    expect(buildMasteringCacheKey(makeVersion({ sizeBytes: 12346 }))).not.toBe(baseKey);
    expect(
      buildMasteringCacheKey(makeVersion({ modifiedAt: '2026-05-07T00:00:01.000Z' }))
    ).not.toBe(baseKey);
  });

  it('treats entries as fresh only for the unchanged session cache key', () => {
    const version = makeVersion();
    const entry = makeEntry(version);

    expect(isMasteringCacheEntryFresh(entry, version)).toBe(true);
    expect(isMasteringCacheEntryFresh(entry, makeVersion({ sizeBytes: 99999 }))).toBe(false);
    expect(
      isMasteringCacheEntryFresh(
        { ...entry, schemaVersion: MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION + 1 },
        version
      )
    ).toBe(false);
  });

  it('normalizes missing or invalid mtimes to zero instead of reusing a bogus date', () => {
    expect(parseVersionModifiedAtMs(makeVersion({ modifiedAt: 'not-a-date' }))).toBe(0);
    expect(parseVersionModifiedAtMs(makeVersion({ modifiedAt: '1969-12-31T23:59:59.000Z' }))).toBe(0);
  });

  // v3.270 — Cache-freshness regression coverage for the bit-depth-null
  // case Ethan hit on Mini after the v3.269 in-flight install (voice 7213,
  // 2026-05-29). The relevant scenarios all stay at schemaVersion=2 +
  // matching cacheKey — the new staleness signal is purely about the
  // staticAnalysis.bitDepth/sampleFormat shape.
  describe('bit-depth-null freshness (v3.270)', () => {
    it('forces re-analysis when bitDepth is null on a PCM sampleFormat (.wav s32)', () => {
      const version = makeVersion();
      const entry = makeEntry(version, { bitDepth: null, sampleFormat: 's32' });
      expect(isMasteringCacheEntryFresh(entry, version)).toBe(false);
    });

    it('forces re-analysis when bitDepth is null on a PCM sampleFormat (.flac s16)', () => {
      const version = makeVersion({ extension: 'flac', filePath: '/mixes/Alpha v1.flac', fileName: 'Alpha v1.flac' });
      const entry = makeEntry(version, { bitDepth: null, sampleFormat: 's16' }, { extension: 'flac' });
      expect(isMasteringCacheEntryFresh(entry, version)).toBe(false);
    });

    it('forces re-analysis when bitDepth is null AND sampleFormat is null on a lossless extension', () => {
      // Trigger case: very old entry where sampleFormat wasn't yet stored.
      // We fall back to the file extension to decide it's a PCM source.
      const version = makeVersion();
      const entry = makeEntry(version, { bitDepth: null, sampleFormat: null });
      expect(isMasteringCacheEntryFresh(entry, version)).toBe(false);
    });

    it('keeps entries fresh when bitDepth is null on a true lossy source (.mp3)', () => {
      // mp3 has no PCM bit depth — null is the correct stored value.
      // Don't re-analyse this needlessly.
      const version = makeVersion({ extension: 'mp3', filePath: '/mixes/Alpha v1.mp3', fileName: 'Alpha v1.mp3' });
      const entry = makeEntry(
        version,
        { bitDepth: null, sampleFormat: null },
        { extension: 'mp3' }
      );
      expect(isMasteringCacheEntryFresh(entry, version)).toBe(true);
    });

    it('keeps entries fresh when bitDepth is null and sampleFormat is a planar-variant PCM string', () => {
      // The check normalises trailing `p` (planar). `fltp` → `flt`, so a
      // bitDepth=null on planar float WAS produced by an older code path
      // and should re-analyse.
      const version = makeVersion();
      const entry = makeEntry(version, { bitDepth: null, sampleFormat: 'fltp' });
      expect(isMasteringCacheEntryFresh(entry, version)).toBe(false);
    });

    it('keeps entries fresh when bitDepth is a concrete number (24)', () => {
      const version = makeVersion();
      const entry = makeEntry(version, { bitDepth: 24, sampleFormat: 's32' });
      expect(isMasteringCacheEntryFresh(entry, version)).toBe(true);
    });
  });
});
