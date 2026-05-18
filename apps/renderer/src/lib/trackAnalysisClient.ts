/**
 * v3.240 — Web Worker client wrapper for track analysis.
 *
 * Boots a single long-lived worker (lazy on first use) and exposes a
 * Promise-based API for posting AudioBuffer channel data + receiving the
 * computed `TrackAnalysisResult` back. Mirrors the contract that the legacy
 * inline `analyzeTrackFromUrl` exposed so callers don't have to change shape.
 *
 * Why one shared worker (not per-request, the way idealStemWorker.ts spins
 * one up per call):
 *   - The analysis queue (`audioAnalysisQueue.ts`) already caps preview
 *     concurrency at 1, so there is only ever one in-flight preview analysis
 *     at a time — a single worker is sufficient.
 *   - Recreating a module worker on every track switch is ~5-15ms wasted in
 *     the same play-start window we're trying to keep clear.
 *
 * Cross-platform note: `Worker` + `new URL(..., import.meta.url)` is the same
 * pattern used by `idealStemWorker.ts` which already ships on macOS, Windows,
 * and Linux Electron 40 builds. No platform-specific code paths needed.
 *
 * Fallback: if the Worker constructor throws (older runtime, Vitest jsdom),
 * we transparently fall back to running the same `runTrackAnalysisCore`
 * function on the main thread so the app still produces correct results.
 */

import {
  type TrackAnalysisWorkerRequest,
  type TrackAnalysisWorkerResponse,
  runTrackAnalysisCore,
} from '../trackAnalysisCore';
import type { TrackAnalysisResult } from '../audioAnalysis';

type PendingRequest = {
  resolve: (value: TrackAnalysisResult) => void;
  reject: (error: Error) => void;
  durationSeconds: number;
  signal?: AbortSignal;
  onAbort?: () => void;
};

let cachedWorker: Worker | null = null;
let cachedWorkerBroken = false;
const pendingRequests = new Map<string, PendingRequest>();

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fail(id: string, error: Error): void {
  const pending = pendingRequests.get(id);
  if (!pending) {
    return;
  }
  pendingRequests.delete(id);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort);
  }
  pending.reject(error);
}

function succeed(id: string, value: TrackAnalysisResult): void {
  const pending = pendingRequests.get(id);
  if (!pending) {
    return;
  }
  pendingRequests.delete(id);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort);
  }
  pending.resolve(value);
}

function bootWorker(): Worker | null {
  if (cachedWorkerBroken) {
    return null;
  }
  if (cachedWorker) {
    return cachedWorker;
  }
  try {
    const worker = new Worker(
      new URL('../trackAnalysisWorker.ts', import.meta.url),
      { type: 'module', name: 'producer-player-track-analysis' },
    );

    worker.onmessage = (event: MessageEvent<TrackAnalysisWorkerResponse>) => {
      const data = event.data;
      if (!data || typeof data.id !== 'string') {
        return;
      }
      const pending = pendingRequests.get(data.id);
      if (!pending) {
        return;
      }
      if (data.ok) {
        const r = data.result;
        succeed(data.id, {
          peakDbfs: r.peakDbfs,
          integratedLufsEstimate: r.integratedLufsEstimate,
          frameLoudnessDbfs: r.frameLoudnessDbfs,
          frameDurationSeconds: r.frameDurationSeconds,
          durationSeconds: r.durationSeconds,
          tonalBalance: r.tonalBalance,
          rmsDbfs: r.rmsDbfs,
          crestFactorDb: r.crestFactorDb,
          dcOffset: r.dcOffset,
          clipCount: r.clipCount,
          waveformPeaks: new Float32Array(r.waveformPeaks),
        });
      } else {
        fail(data.id, new Error(data.error || 'Track analysis worker failed.'));
      }
    };
    worker.onerror = (event) => {
      // If the worker itself crashes (rare), reject all in-flight requests
      // and tear it down. Subsequent calls will retry once (which may then
      // mark it as broken if it crashes again on boot).
      const message = event.message || 'Track analysis worker crashed.';
      const ids = Array.from(pendingRequests.keys());
      for (const id of ids) {
        fail(id, new Error(message));
      }
      worker.terminate();
      if (cachedWorker === worker) {
        cachedWorker = null;
      }
    };

    cachedWorker = worker;
    return worker;
  } catch (cause) {
    // Module workers might not be available in the current runtime (e.g.
    // Vitest jsdom). Mark the worker as broken and fall back to inline
    // execution from now on.
    cachedWorkerBroken = true;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        '[trackAnalysisClient] Worker unavailable, falling back to main-thread analysis.',
        cause,
      );
    }
    return null;
  }
}

/**
 * Extract per-channel Float32Array data from an AudioBuffer in a way that
 * does NOT copy the underlying PCM data twice. Each returned Float32Array
 * is backed by its own ArrayBuffer (a copy of the AudioBuffer's channel
 * data) so the buffers can be safely transferred to the worker.
 */
function extractTransferableChannels(buffer: AudioBuffer): Float32Array[] {
  const channelCount = buffer.numberOfChannels;
  const channels: Float32Array[] = new Array(channelCount);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    // `getChannelData` returns a reference to the AudioBuffer's internal
    // storage. We must copy it into a fresh Float32Array so transferring
    // its underlying buffer to the worker doesn't detach the AudioBuffer's
    // internal state (which could break any code that still holds a
    // reference to the buffer post-analysis).
    const source = buffer.getChannelData(channelIndex);
    const copy = new Float32Array(source.length);
    copy.set(source);
    channels[channelIndex] = copy;
  }
  return channels;
}

/**
 * Analyse an AudioBuffer off the main thread. Returns the same
 * `TrackAnalysisResult` shape that the legacy inline path produced. If a
 * Worker can't be booted (test runner, exotic platform), falls back to
 * running the same core function inline so behaviour stays correct.
 *
 * The provided `signal` (if any) is honoured AFTER the message has been
 * posted: an abort will reject the pending promise, but the worker will
 * still run to completion (cheap; the queue's concurrency=1 ensures we
 * don't pile up stale work). For most callers this is exactly what they
 * want — the queue layer in `audioAnalysis.ts` already handles aborts
 * before the work is dispatched.
 */
export function analyzeAudioBufferInWorker(
  buffer: AudioBuffer,
  signal?: AbortSignal,
): Promise<TrackAnalysisResult> {
  const channels = extractTransferableChannels(buffer);
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const durationSeconds = buffer.duration;

  const worker = bootWorker();
  if (!worker) {
    // Fallback path: synchronous main-thread analysis. Wrap in a
    // microtask-resolved Promise so the contract still returns a thenable.
    return Promise.resolve().then(() => {
      if (signal?.aborted) {
        throw new DOMException('The analysis request was aborted.', 'AbortError');
      }
      return runTrackAnalysisCore(channels, sampleRate, durationSeconds, length);
    });
  }

  return new Promise<TrackAnalysisResult>((resolve, reject) => {
    const id = generateRequestId();
    let onAbort: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('The analysis request was aborted.', 'AbortError'));
        return;
      }
      onAbort = () => {
        fail(id, new DOMException('The analysis request was aborted.', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    pendingRequests.set(id, {
      resolve,
      reject,
      durationSeconds,
      signal,
      onAbort,
    });

    const channelBuffers = channels.map((c) => c.buffer as ArrayBuffer);
    const request: TrackAnalysisWorkerRequest = {
      id,
      channels: channelBuffers,
      sampleRate,
      durationSeconds,
      length,
    };
    try {
      worker.postMessage(request, channelBuffers);
    } catch (cause) {
      fail(id, cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}

/**
 * Test/diagnostic helper: tear down the cached worker so the next call
 * boots a fresh one. No-op if no worker has been booted yet.
 */
export function __resetTrackAnalysisWorkerForTests(): void {
  if (cachedWorker) {
    cachedWorker.terminate();
    cachedWorker = null;
  }
  cachedWorkerBroken = false;
  pendingRequests.clear();
}
