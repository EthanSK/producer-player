import { describe, expect, it } from 'vitest';
import { cacheAnalysisValue } from './analysisMemoryCache';

describe('cacheAnalysisValue', () => {
  it('keeps every processed track version in memory by default', () => {
    const cache = new Map<string, number>();

    for (let index = 0; index < 120; index += 1) {
      cacheAnalysisValue(cache, `version-${index}`, index);
    }

    expect(cache.size).toBe(120);
    expect(cache.get('version-0')).toBe(0);
    expect(cache.get('version-119')).toBe(119);
  });

  it('still supports explicit finite LRU limits for non-analysis callers/tests', () => {
    const cache = new Map<string, number>();

    cacheAnalysisValue(cache, 'a', 1, 2);
    cacheAnalysisValue(cache, 'b', 2, 2);
    cacheAnalysisValue(cache, 'c', 3, 2);

    expect([...cache.keys()]).toEqual(['b', 'c']);
  });

  it('refreshes insertion order when replacing an existing key', () => {
    const cache = new Map<string, number>();

    cacheAnalysisValue(cache, 'a', 1, 2);
    cacheAnalysisValue(cache, 'b', 2, 2);
    cacheAnalysisValue(cache, 'a', 10, 2);
    cacheAnalysisValue(cache, 'c', 3, 2);

    expect([...cache.entries()]).toEqual([
      ['a', 10],
      ['c', 3],
    ]);
  });
});
