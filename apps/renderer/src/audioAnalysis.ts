import {
  AnalysisQueue,
  ANALYSIS_PRIORITY_BACKGROUND,
  ANALYSIS_PRIORITY_USER_SELECTED,
  type AnalysisPriority,
} from './audioAnalysisQueue';
import { analyzeAudioBufferInWorker } from './lib/trackAnalysisClient';

export interface TonalBalanceSnapshot {
  low: number;
  mid: number;
  high: number;
}

export interface TrackAnalysisResult {
  peakDbfs: number;
  integratedLufsEstimate: number;
  frameLoudnessDbfs: number[];
  frameDurationSeconds: number;
  durationSeconds: number;
  tonalBalance: TonalBalanceSnapshot;
  rmsDbfs: number;
  crestFactorDb: number;
  dcOffset: number;
  clipCount: number;
  waveformPeaks: Float32Array;
}

const MIN_DECIBELS = -96;
const LOUDNESS_WINDOW_SECONDS = 3;

// Full-track decode can be very memory-hungry for long WAV/AIFF files.
// We keep concurrency=1 here so we never have two huge decoded AudioBuffers
// alive at the same moment. The priority queue lets a user-selected track
// jump ahead of pending background-preload jobs (item #10, v3.110). Re-export
// the queue priorities so callers don't need a second import.
const previewAnalysisQueue = new AnalysisQueue({
  concurrency: 1,
  label: 'preview-analysis',
  // Item #14/v3.219 — user-selected preview decode first interrupts
  // cancellable lower-priority preview work; bounded bypass remains as a
  // fallback if the browser does not stop an in-flight decode promptly.
  maxUserBypassSlots: 2,
});

export {
  ANALYSIS_PRIORITY_BACKGROUND,
  ANALYSIS_PRIORITY_NEIGHBOR,
  ANALYSIS_PRIORITY_USER_SELECTED,
} from './audioAnalysisQueue';
export type { AnalysisPriority } from './audioAnalysisQueue';

function createAbortError(): Error {
  return new DOMException('The analysis request was aborted.', 'AbortError');
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createCompositeAbortSignal(
  signals: Array<AbortSignal | undefined>
): { signal: AbortSignal; cleanup: () => void } {
  const activeSignals = signals.filter((candidate): candidate is AbortSignal =>
    Boolean(candidate)
  );
  if (activeSignals.length === 0) {
    const controller = new AbortController();
    return { signal: controller.signal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  for (const activeSignal of activeSignals) {
    if (activeSignal.aborted) {
      abort();
      break;
    }
    activeSignal.addEventListener('abort', abort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const activeSignal of activeSignals) {
        activeSignal.removeEventListener('abort', abort);
      }
    },
  };
}

function amplitudeToDbfs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return MIN_DECIBELS;
  }

  return Math.max(MIN_DECIBELS, 20 * Math.log10(value));
}

// Internal: enqueue a preview-analysis task with the shared priority queue.
function runPreviewAnalysis<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: { priority?: AnalysisPriority; key?: string; label?: string } = {}
): Promise<T> {
  return previewAnalysisQueue.enqueue(task, {
    ...options,
    cancellable: true,
  });
}

/**
 * Reprioritize a queued preview analysis (item #10). Useful when the user
 * clicks a track that was already enqueued at background priority — we want
 * it to jump ahead of the rest of the preload queue without re-decoding.
 *
 * No-op when the task is already running, has settled, or was never enqueued.
 */
export function promotePreviewAnalysis(
  key: string,
  priority: AnalysisPriority = ANALYSIS_PRIORITY_USER_SELECTED
): void {
  previewAnalysisQueue.promote(key, priority);
}

/**
 * v3.190/v3.219 — Demote preview analysis to a lower priority. Called by
 * App.tsx when the user rapidly switches from track A to track B: A's stale
 * USER_SELECTED preview should stop competing with B and, if already running,
 * become eligible for B's interrupt path.
 */
export function demotePreviewAnalysis(
  key: string,
  priority: AnalysisPriority
): void {
  previewAnalysisQueue.demote(key, priority);
}

/**
 * v3.115 Windows-CI diagnostic: expose preview queue stats so e2e specs can
 * dump them on failure.
 */
export function getPreviewAnalysisQueueStats(): {
  active: number;
  pending: number;
  concurrency: number;
  label: string;
  userBypassActive: number;
} {
  return previewAnalysisQueue.stats();
}

/**
 * Item #14 (v3.118) — full per-priority dump for the background-tasks
 * indicator UI in the status sidebar.
 */
export function dumpPreviewAnalysisQueue(): ReturnType<AnalysisQueue['dump']> {
  return previewAnalysisQueue.dump();
}

export async function analyzeTrackFromUrl(
  url: string,
  signal?: AbortSignal,
  options: { priority?: AnalysisPriority; key?: string; label?: string } = {}
): Promise<TrackAnalysisResult> {
  return runPreviewAnalysis(async (queueSignal) => {
    const composite = createCompositeAbortSignal([signal, queueSignal]);
    let context: AudioContext | null = null;
    const closeContextOnAbort = (): void => {
      if (context) {
        void context.close().catch(() => undefined);
      }
    };
    composite.signal.addEventListener('abort', closeContextOnAbort, { once: true });

    try {
      ensureNotAborted(composite.signal);

      const response = await fetch(url, { signal: composite.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch analysis source (${response.status}).`);
      }

      const bytes = await response.arrayBuffer();
      ensureNotAborted(composite.signal);

      context = new AudioContext();

      // Pass the fetched buffer directly so we do not allocate a second
      // full-size copy of long audio files right before decode.
      const buffer = await context.decodeAudioData(bytes);
      ensureNotAborted(composite.signal);

      // v3.240 — Push the per-sample CPU loops off the renderer main thread
      // into a dedicated module worker. Voice 3288: the v3.237 setTimeout(500)
      // only deferred WHEN the loops ran; they still blocked the audio engine
      // once they started. By transferring the channel data into a worker,
      // the main thread stays free for high-resolution audio scheduling
      // during play-start. Same pattern as `idealStemWorker.ts` which has
      // shipped cross-platform since v3.179. See `trackAnalysisCore.ts` for
      // the pure-function pipeline shared with the in-process fallback.
      const result = await analyzeAudioBufferInWorker(buffer, composite.signal);
      ensureNotAborted(composite.signal);
      return result;
    } catch (error) {
      if (composite.signal.aborted) {
        throw createAbortError();
      }
      throw error;
    } finally {
      composite.signal.removeEventListener('abort', closeContextOnAbort);
      composite.cleanup();
      if (context) {
        void context.close().catch(() => undefined);
      }
    }
  }, options);
}

export function estimateShortTermLufs(
  analysis: TrackAnalysisResult,
  currentTimeSeconds: number
): number {
  const frameCount = analysis.frameLoudnessDbfs.length;
  if (frameCount === 0 || analysis.frameDurationSeconds <= 0) {
    return MIN_DECIBELS;
  }

  const safeTimeSeconds = Number.isFinite(currentTimeSeconds) && currentTimeSeconds >= 0
    ? Math.min(currentTimeSeconds, analysis.durationSeconds)
    : 0;

  const endFrameExclusive = Math.max(
    1,
    Math.min(frameCount, Math.ceil(safeTimeSeconds / analysis.frameDurationSeconds) || 1)
  );
  const windowFrameCount = Math.max(
    1,
    Math.round(LOUDNESS_WINDOW_SECONDS / analysis.frameDurationSeconds)
  );
  const startFrame = Math.max(0, endFrameExclusive - windowFrameCount);

  let linearPower = 0;
  let count = 0;
  for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex += 1) {
    const amplitude = 10 ** (analysis.frameLoudnessDbfs[frameIndex] / 20);
    linearPower += amplitude * amplitude;
    count += 1;
  }

  const rms = count > 0 ? Math.sqrt(linearPower / count) : 0;
  return amplitudeToDbfs(rms);
}
