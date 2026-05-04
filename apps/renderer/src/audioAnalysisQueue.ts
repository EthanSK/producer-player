// Priority-aware task pool for audio analysis jobs.
//
// Item #10 (v3.110) — track-switch precompute / cache. We previously serialized
// every analysis job through a single FIFO promise chain (`runSerializedAnalysis`
// in audioAnalysis.ts). That meant the user-priority track had to wait behind
// every queued background-preload job, which made track switching feel slow on
// large albums with rapid switching mid-preload.
//
// This pool is the throttle + priority layer used by:
//   - the renderer-side `analyzeTrackFromUrl` decoder (concurrency=1, memory-
//     bound: a single full WAV decode can take hundreds of MB)
//   - the renderer-side wrapper around `window.producerPlayer.analyzeAudioFile`
//     (ffmpeg ebur128, concurrency=2 — modest CPU + IPC roundtrip)
//
// Behavior:
//   - lower priority value runs first (0 = user-selected, 1 = neighbor, 2 = bg)
//   - within the same priority level, tasks are FIFO
//   - concurrent task cap is enforced; new jobs run as soon as a worker frees
//   - tasks de-dupe by `key` when provided: identical pending key returns the
//     in-flight promise instead of enqueueing a duplicate analysis job
//   - calling `promote(key, priority)` re-orders an already-queued task (no-op
//     if the task is already running, dropped, or absent)
//
// Memory and CPU bounds are documented at each callsite. The cache-eviction
// LRU lives in App.tsx (`previewAnalysisCacheRef`, `measuredAnalysisCacheRef`)
// — this module is purely about scheduling.

export type AnalysisPriority = 0 | 1 | 2;

export const ANALYSIS_PRIORITY_USER_SELECTED: AnalysisPriority = 0;
export const ANALYSIS_PRIORITY_NEIGHBOR: AnalysisPriority = 1;
export const ANALYSIS_PRIORITY_BACKGROUND: AnalysisPriority = 2;

interface QueuedTask<T> {
  key: string | null;
  priority: AnalysisPriority;
  insertionOrder: number;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface AnalysisQueueOptions {
  /**
   * Maximum number of concurrent in-flight tasks. Must be >= 1.
   */
  concurrency: number;
  /**
   * Optional human-readable label used by `dump()` (debugging only).
   */
  label?: string;
}

export interface EnqueueOptions {
  /**
   * Optional de-dupe key. If a task with the same key is already pending or
   * running, the new request resolves with the SAME result. Two callers asking
   * for the same analysis at once will not run the task twice.
   */
  key?: string;
  /**
   * Priority bucket. Lower runs first. Default: BACKGROUND.
   */
  priority?: AnalysisPriority;
}

export class AnalysisQueue {
  private readonly concurrency: number;
  private readonly label: string;
  private readonly pending: QueuedTask<unknown>[] = [];
  private readonly runningKeys = new Set<string>();
  // In-flight + pending dedupe map: key -> the resolved promise the caller can
  // await. Cleared once the underlying task settles.
  private readonly inflightByKey = new Map<string, Promise<unknown>>();
  private nextInsertionOrder = 0;
  private active = 0;

  constructor(options: AnalysisQueueOptions) {
    if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
      throw new Error(
        `AnalysisQueue concurrency must be >= 1 (got ${options.concurrency})`
      );
    }
    this.concurrency = Math.floor(options.concurrency);
    this.label = options.label ?? 'analysis-queue';
  }

  /**
   * Enqueue a task. Returns a promise that settles when the task runs.
   *
   * Identical `key` values short-circuit to the existing in-flight or pending
   * task — useful when both a background preloader and a user-selection effect
   * race for the same track on near-simultaneous renders.
   */
  enqueue<T>(task: () => Promise<T>, options: EnqueueOptions = {}): Promise<T> {
    const priority = options.priority ?? ANALYSIS_PRIORITY_BACKGROUND;
    const key = options.key ?? null;

    if (key !== null) {
      const existing = this.inflightByKey.get(key);
      if (existing) {
        // Promote the existing task if the caller asked for a higher priority.
        // No-op if it's already running.
        this.promote(key, priority);
        return existing as Promise<T>;
      }
    }

    return new Promise<T>((resolve, reject) => {
      const queued: QueuedTask<T> = {
        key,
        priority,
        insertionOrder: this.nextInsertionOrder++,
        task,
        resolve,
        reject,
      };

      this.pending.push(queued as QueuedTask<unknown>);

      if (key !== null) {
        // Track the externally-visible promise so a duplicate enqueue can
        // dedupe to the SAME promise (this Promise we're inside of right now).
        // We do this by stashing the resolver via a tiny helper promise.
        const dedupePromise = new Promise<T>((dedupeResolve, dedupeReject) => {
          // Replace resolve/reject with multi-cast wrappers.
          const originalResolve = queued.resolve;
          const originalReject = queued.reject;
          queued.resolve = (value) => {
            originalResolve(value);
            dedupeResolve(value);
          };
          queued.reject = (reason) => {
            originalReject(reason);
            dedupeReject(reason);
          };
        });
        this.inflightByKey.set(key, dedupePromise as Promise<unknown>);
      }

      this.maybeStart();
    });
  }

  /**
   * Re-prioritize a queued task by key. No-op if the task is already running,
   * cancelled, or never enqueued. Lower priority values run sooner.
   */
  promote(key: string, priority: AnalysisPriority): void {
    if (!this.runningKeys.has(key)) {
      for (const task of this.pending) {
        if (task.key === key && priority < task.priority) {
          task.priority = priority;
        }
      }
    }
  }

  /**
   * Returns counts useful for tests / debugging.
   */
  stats(): { active: number; pending: number; concurrency: number; label: string } {
    return {
      active: this.active,
      pending: this.pending.length,
      concurrency: this.concurrency,
      label: this.label,
    };
  }

  private comparePending(a: QueuedTask<unknown>, b: QueuedTask<unknown>): number {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.insertionOrder - b.insertionOrder;
  }

  private popNext(): QueuedTask<unknown> | undefined {
    if (this.pending.length === 0) {
      return undefined;
    }

    let bestIndex = 0;
    for (let i = 1; i < this.pending.length; i += 1) {
      if (this.comparePending(this.pending[i], this.pending[bestIndex]) < 0) {
        bestIndex = i;
      }
    }
    const [next] = this.pending.splice(bestIndex, 1);
    return next;
  }

  private maybeStart(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const next = this.popNext();
      if (!next) {
        return;
      }
      this.active += 1;
      if (next.key !== null) {
        this.runningKeys.add(next.key);
      }

      Promise.resolve()
        .then(() => next.task())
        .then(
          (value) => {
            next.resolve(value);
          },
          (reason) => {
            next.reject(reason);
          }
        )
        .finally(() => {
          this.active -= 1;
          if (next.key !== null) {
            this.runningKeys.delete(next.key);
            this.inflightByKey.delete(next.key);
          }
          this.maybeStart();
        });
    }
  }
}
