import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDEAL_STEM_IDS } from './idealCurves';
import {
  IDEAL_STEM_PROVIDER_DISCLOSURE,
  IDEAL_STEM_PROVIDER_ID,
  IDEAL_STEM_PROVIDER_LABEL,
} from './idealStemAnalysisCore';
import {
  analyzeIdealStemSource,
  buildIdealStemCacheKey,
  clearIdealStemAnalysisCache,
  getCachedIdealStemAnalysis,
  getIdealStemCacheState,
  type IdealStemAnalysisSource,
} from './idealStemAnalysis';

const source: IdealStemAnalysisSource = {
  kind: 'mix',
  label: 'Your Mix',
  fileName: 'song-v2.wav',
  filePath: '/Music/song-v2.wav',
  url: 'producer-media://song-v2.wav',
  sizeBytes: 1234,
  modifiedAt: '2026-05-08T20:00:00.000Z',
  versionId: 'version-2',
  sourceStrategy: 'direct-file',
  exists: true,
};

class MockAudioBuffer {
  public readonly length = 8;
  public readonly numberOfChannels = 1;
  public readonly sampleRate = 44100;
  private readonly channel = new Float32Array([0, 0.1, 0.2, 0.1, 0, -0.1, -0.2, -0.1]);

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class MockAudioContext {
  decodeAudioData = vi.fn(async () => new MockAudioBuffer());
  close = vi.fn(async () => undefined);
}

let workerRunCount = 0;
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: { id: string; monoSamples: ArrayBuffer; sampleRate: number }): void {
    workerRunCount += 1;
    setTimeout(() => {
      this.onmessage?.({
        data: {
          id: message.id,
          ok: true,
          provider: {
            id: IDEAL_STEM_PROVIDER_ID,
            label: IDEAL_STEM_PROVIDER_LABEL,
            disclosure: IDEAL_STEM_PROVIDER_DISCLOSURE,
            isApproximation: true,
          },
          stems: IDEAL_STEM_IDS.map((stemId) => ({
            stemId,
            curve: [
              { freq: 20, gainDb: -12 },
              { freq: 20000, gainDb: 0 },
            ],
            metrics: {
              peakDbfs: -1,
              rmsDbfs: -12,
              durationSeconds: 1,
              sampleRate: message.sampleRate,
            },
            wavBuffer: new ArrayBuffer(44),
          })),
        },
      } as MessageEvent);
    }, 0);
  }

  terminate(): void {
    // no-op in test double
  }
}

describe('ideal stem analysis cache', () => {
  const originalFetch = globalThis.fetch;
  const originalAudioContext = globalThis.AudioContext;
  const originalWorker = globalThis.Worker;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    clearIdealStemAnalysisCache();
    workerRunCount = 0;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(16),
    })) as unknown as typeof fetch;
    globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    URL.createObjectURL = vi.fn(() => `blob:stem-${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    clearIdealStemAnalysisCache();
    globalThis.fetch = originalFetch;
    globalThis.AudioContext = originalAudioContext;
    globalThis.Worker = originalWorker;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('builds stable keys that invalidate on size, mtime, version, and reference identity changes', () => {
    const baseKey = buildIdealStemCacheKey(source);
    expect(buildIdealStemCacheKey({ ...source })).toBe(baseKey);
    expect(buildIdealStemCacheKey({ ...source, sizeBytes: 9999 })).not.toBe(baseKey);
    expect(buildIdealStemCacheKey({ ...source, modifiedAt: '2026-05-08T21:00:00.000Z' })).not.toBe(baseKey);
    expect(buildIdealStemCacheKey({ ...source, versionId: 'version-3' })).not.toBe(baseKey);

    const referenceKey = buildIdealStemCacheKey({
      ...source,
      kind: 'reference',
      versionId: null,
      referenceIdentity: '/Refs/pro-master.wav',
    });
    expect(referenceKey).toContain('reference=/Refs/pro-master.wav');
    expect(referenceKey).not.toBe(baseKey);
  });

  it('reuses in-flight and completed analyses for the same stable audio identity', async () => {
    const cacheKey = buildIdealStemCacheKey(source);
    expect(getIdealStemCacheState(cacheKey)).toBe('idle');

    const first = analyzeIdealStemSource(source);
    const second = analyzeIdealStemSource({ ...source });
    expect(getIdealStemCacheState(cacheKey)).toBe('in-flight');

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(workerRunCount).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(getIdealStemCacheState(cacheKey)).toBe('ready');
    expect(getCachedIdealStemAnalysis(cacheKey)).toBe(firstResult);

    const thirdResult = await analyzeIdealStemSource(source);
    expect(thirdResult).toBe(firstResult);
    expect(workerRunCount).toBe(1);
  });
});
