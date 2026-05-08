import {
  AnalysisQueue,
  ANALYSIS_PRIORITY_USER_SELECTED,
  type AnalysisPriority,
} from './audioAnalysisQueue';
import {
  createMonoSamplesFromChannels,
  IDEAL_STEM_PROVIDER_DISCLOSURE,
  IDEAL_STEM_PROVIDER_ID,
  IDEAL_STEM_PROVIDER_LABEL,
  type IdealStemMetrics,
} from './idealStemAnalysisCore';
import { IDEAL_STEM_IDS, type IdealCurvePoint, type IdealStemId } from './idealCurves';

export type IdealStemSourceKind = 'mix' | 'reference';

export interface IdealStemAnalysisSource {
  kind: IdealStemSourceKind;
  label: string;
  fileName: string;
  filePath: string | null;
  url: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  versionId?: string | null;
  referenceIdentity?: string | null;
  sourceStrategy?: string | null;
  exists?: boolean;
}

export interface IdealStemAnalysisProvider {
  id: string;
  label: string;
  disclosure: string;
  isApproximation: boolean;
  quality?: 'fallback' | 'ml';
}

export interface IdealStemAnalysisStem {
  stemId: IdealStemId;
  curve: IdealCurvePoint[];
  audioUrl: string;
  metrics: IdealStemMetrics;
}

export type IdealStemAnalysisStemById = Record<IdealStemId, IdealStemAnalysisStem>;

export interface IdealStemAnalysisResult {
  cacheKey: string;
  source: IdealStemAnalysisSource;
  provider: IdealStemAnalysisProvider;
  stems: IdealStemAnalysisStemById;
  createdAt: string;
}

export type IdealStemCacheState = 'idle' | 'ready' | 'in-flight';

interface IdealStemWorkerStemResponse {
  stemId: IdealStemId;
  curve: IdealCurvePoint[];
  metrics: IdealStemMetrics;
  wavBuffer: ArrayBuffer;
}

interface IdealStemWorkerSuccessResponse {
  id: string;
  ok: true;
  provider: IdealStemAnalysisProvider;
  stems: IdealStemWorkerStemResponse[];
}

interface IdealStemWorkerFailureResponse {
  id: string;
  ok: false;
  error: string;
}

type IdealStemWorkerResponse = IdealStemWorkerSuccessResponse | IdealStemWorkerFailureResponse;

const IDEAL_STEM_CACHE_SCHEMA_VERSION = 1;

const idealStemAnalysisQueue = new AnalysisQueue({
  concurrency: 1,
  label: 'ideal-stem-analysis',
  maxUserBypassSlots: 1,
});

const resultCache = new Map<string, IdealStemAnalysisResult>();
const inFlight = new Map<string, Promise<IdealStemAnalysisResult>>();

function sourceField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function buildIdealStemCacheKey(source: IdealStemAnalysisSource): string {
  return [
    `ideal-stems-v${IDEAL_STEM_CACHE_SCHEMA_VERSION}`,
    `kind=${sourceField(source.kind)}`,
    `version=${sourceField(source.versionId)}`,
    `path=${sourceField(source.filePath)}`,
    `url=${sourceField(source.url)}`,
    `name=${sourceField(source.fileName)}`,
    `size=${sourceField(source.sizeBytes)}`,
    `mtime=${sourceField(source.modifiedAt)}`,
    `reference=${sourceField(source.referenceIdentity)}`,
    `strategy=${sourceField(source.sourceStrategy)}`,
  ].join('::');
}

export function getIdealStemCacheState(cacheKey: string | null | undefined): IdealStemCacheState {
  if (!cacheKey) return 'idle';
  if (resultCache.has(cacheKey)) return 'ready';
  if (inFlight.has(cacheKey)) return 'in-flight';
  return 'idle';
}

export function getCachedIdealStemAnalysis(
  cacheKeyOrSource: string | IdealStemAnalysisSource | null | undefined,
): IdealStemAnalysisResult | null {
  if (!cacheKeyOrSource) return null;
  const cacheKey =
    typeof cacheKeyOrSource === 'string'
      ? cacheKeyOrSource
      : buildIdealStemCacheKey(cacheKeyOrSource);
  return resultCache.get(cacheKey) ?? null;
}

export function clearIdealStemAnalysisCache(
  cacheKeyOrSource?: string | IdealStemAnalysisSource | null,
): void {
  if (!cacheKeyOrSource) {
    for (const result of resultCache.values()) {
      revokeStemUrls(result);
    }
    resultCache.clear();
    return;
  }

  const cacheKey =
    typeof cacheKeyOrSource === 'string'
      ? cacheKeyOrSource
      : buildIdealStemCacheKey(cacheKeyOrSource);
  const result = resultCache.get(cacheKey);
  if (result) {
    revokeStemUrls(result);
    resultCache.delete(cacheKey);
  }

}

function revokeStemUrls(result: IdealStemAnalysisResult): void {
  for (const stem of Object.values(result.stems)) {
    URL.revokeObjectURL(stem.audioUrl);
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The ideal-stem analysis request was aborted.', 'AbortError');
  }
  const error = new Error('The ideal-stem analysis request was aborted.');
  error.name = 'AbortError';
  return error;
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export async function analyzeIdealStemSource(
  source: IdealStemAnalysisSource,
  options: {
    signal?: AbortSignal;
    force?: boolean;
    priority?: AnalysisPriority;
  } = {},
): Promise<IdealStemAnalysisResult> {
  const cacheKey = buildIdealStemCacheKey(source);

  if (options.force) {
    clearIdealStemAnalysisCache(cacheKey);
  }

  const cached = resultCache.get(cacheKey);
  if (cached && !options.force) {
    return cached;
  }

  const existing = inFlight.get(cacheKey);
  if (existing && !options.force) {
    return existing;
  }

  const promise = idealStemAnalysisQueue
    .enqueue(
      () => runIdealStemAnalysis(source, cacheKey, options.signal),
      {
        key: cacheKey,
        label: `${source.kind}: ${source.fileName}`,
        priority: options.priority ?? ANALYSIS_PRIORITY_USER_SELECTED,
      },
    )
    .then((result) => {
      resultCache.set(cacheKey, result);
      return result;
    })
    .finally(() => {
      if (inFlight.get(cacheKey) === promise) {
        inFlight.delete(cacheKey);
      }
    });

  inFlight.set(cacheKey, promise);
  return promise;
}

async function runIdealStemAnalysis(
  source: IdealStemAnalysisSource,
  cacheKey: string,
  signal?: AbortSignal,
): Promise<IdealStemAnalysisResult> {
  ensureNotAborted(signal);

  if (source.exists === false) {
    throw new Error(`${source.label} file could not be found.`);
  }

  if (!source.url) {
    throw new Error(`${source.label} does not have a playable audio source yet.`);
  }

  const response = await fetch(source.url, { signal });
  if (!response.ok) {
    throw new Error(`Could not fetch ${source.label} audio (${response.status}).`);
  }

  const bytes = await response.arrayBuffer();
  ensureNotAborted(signal);

  const context = new AudioContext();
  try {
    const audioBuffer = await context.decodeAudioData(bytes);
    ensureNotAborted(signal);

    if (audioBuffer.length === 0 || audioBuffer.numberOfChannels === 0) {
      throw new Error(`${source.label} decoded as empty audio.`);
    }

    const channels: Float32Array[] = [];
    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
      channels.push(audioBuffer.getChannelData(channelIndex));
    }
    const mono = createMonoSamplesFromChannels(channels);
    ensureNotAborted(signal);

    const workerResponse = await analyzeMonoSamplesInWorker(mono, audioBuffer.sampleRate, signal);
    ensureNotAborted(signal);

    if (!workerResponse.ok) {
      throw new Error(workerResponse.error);
    }

    const stems = workerResponse.stems.reduce((result, stem) => {
      const wavBlob = new Blob([stem.wavBuffer], { type: 'audio/wav' });
      result[stem.stemId] = {
        stemId: stem.stemId,
        curve: stem.curve,
        metrics: stem.metrics,
        audioUrl: URL.createObjectURL(wavBlob),
      };
      return result;
    }, {} as Partial<IdealStemAnalysisStemById>);

    for (const stemId of IDEAL_STEM_IDS) {
      if (!stems[stemId]) {
        throw new Error(`Stem analysis did not return ${stemId}.`);
      }
    }

    return {
      cacheKey,
      source,
      provider: workerResponse.provider,
      stems: stems as IdealStemAnalysisStemById,
      createdAt: new Date().toISOString(),
    };
  } catch (cause: unknown) {
    if (cause instanceof DOMException && cause.name === 'EncodingError') {
      throw new Error(`${source.label} could not be decoded. Try a WAV, AIFF, FLAC, MP3, AAC, or another supported audio file.`);
    }
    throw cause;
  } finally {
    void context.close().catch(() => undefined);
  }
}

function analyzeMonoSamplesInWorker(
  mono: Float32Array,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<IdealStemWorkerResponse> {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const worker = new Worker(new URL('./idealStemWorker.ts', import.meta.url), {
      type: 'module',
      name: 'producer-player-ideal-stems',
    });

    let settled = false;
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => {
      settle(() => reject(createAbortError()));
    };

    worker.onmessage = (event: MessageEvent<IdealStemWorkerResponse>) => {
      if (event.data.id !== requestId) {
        return;
      }
      settle(() => resolve(event.data));
    };
    worker.onerror = (event) => {
      const message = event.message || 'Ideal stem worker failed.';
      settle(() => reject(new Error(message)));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    worker.postMessage(
      {
        id: requestId,
        monoSamples: mono.buffer,
        sampleRate,
      },
      [mono.buffer],
    );
  });
}

export function formatIdealStemMetricDb(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} dBFS`;
}
