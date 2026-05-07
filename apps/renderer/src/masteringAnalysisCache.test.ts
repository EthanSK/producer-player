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
    const entry = {
      schemaVersion: MASTERING_ANALYSIS_CACHE_SCHEMA_VERSION,
      cacheKey: buildMasteringCacheKey(version),
    } as MasteringCacheEntry;

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
});
