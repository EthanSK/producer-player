// Priority-aware task pool for audio analysis jobs.
//
// Item #10 (v3.110) — track-switch precompute / cache. We previously serialized
// every analysis job through a single FIFO promise chain (`runSerializedAnalysis`
// in audioAnalysis.ts). That meant the user-priority track had to wait behind
// every queued background-preload job, which made track switching feel slow on
// large albums with rapid switching mid-preload.
//
// Item #14 (v3.118) — bug fix: foreground analysis was still being blocked by
// background precompute. The `promote()` mechanism only re-orders PENDING
// tasks; if a background task was already running (concurrency=1 preview, or
// both concurrency=2 measured slots full), a user-priority job had to wait for
// the running background job(s) to finish. Symptom: integrated LUFS, sample
// rate, version-history all stuck on "loading" right after a track switch
// while the precompute backlog churned. Fix below: user-priority enqueues
// BYPASS the concurrency cap (up to `maxUserBypassSlots`) so a click never
// stalls behind bg work in flight. Bg tasks keep running in parallel; the
// renderer-state cancellation guard in App.tsx stops their stale results from
// clobbering the user-selected view.
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
//   - concurrent task cap is enforced for non-user-priority tasks
//   - user-priority (0) tasks BYPASS the cap when all slots are taken by lower-
//     priority work, up to `maxUserBypassSlots` extra parallel jobs (default 3
//     — enough for typical click-bursts without OOMing the WAV decoder pool)
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
  /**
   * Item #14 — when a user-priority (priority=0) task is enqueued and all
   * regular concurrency slots are taken by lower-priority work, the queue
   * starts the user task IMMEDIATELY in an extra slot up to this cap. This
   * is "preemption by bypass": background tasks keep running, but the user-
   * priority task no longer waits.
   *
   * Defaults to 3 — covers the common case of one user click during 1-2 bg
   * jobs without letting a click-storm OOM the WAV decode pool.
   */
  maxUserBypassSlots?: number;
  /**
   * v3.120 (Item #14 follow-up) — per-task wall-clock timeout in
   * milliseconds. If a task neither resolves nor rejects within this
   * window, the queue rejects the caller's promise with an
   * `AnalysisTaskTimeoutError` and frees the slot so subsequent work can
   * proceed.
   *
   * Why we need this: the underlying analysis paths each have a
   * theoretical "stuck forever" mode that the queue would otherwise inherit:
   *   - `AudioContext.decodeAudioData` can hang on certain malformed
   *     files (no error, no resolve)
   *   - the ffmpeg ebur128 child can deadlock on broken WAV headers
   *   - the IPC roundtrip itself can stall if the main process is busy
   * Letting one stuck job freeze the queue would block every other
   * pending analysis indefinitely — that's the symptom Ethan observed
   * ("It might just be failing because it's literally just stuck
   * forever").
   *
   * Behavior on timeout:
   *   - the original task keeps running in the background; we do NOT try
   *     to abort it (item #14 explicitly avoided AbortController-style
   *     mid-decode kill paths). The slot is freed immediately so the
   *     queue keeps moving.
   *   - the caller's promise rejects with `AnalysisTaskTimeoutError` so
   *     UI code can show a clear error rather than spinning indefinitely.
   *   - if the underlying task eventually settles after the timeout, its
   *     result is dropped silently (no late state writes).
   *
   * Default: 60_000 ms (60 seconds). Set to `0` or `Number.POSITIVE_INFINITY`
   * to disable the timeout for this queue (tests use `0` to stay
   * deterministic without artificial delays).
   */
  taskTimeoutMs?: number;
}

/**
 * v3.120 — error thrown when a queued task exceeds `taskTimeoutMs`. UI code
 * can `instanceof`-check this to show a "analysis timed out" toast rather
 * than the generic "analysis failed" path used for ffmpeg / decode errors.
 */
export class AnalysisTaskTimeoutError extends Error {
  public readonly key: string | null;
  public readonly priority: AnalysisPriority;
  public readonly label: string;
  public readonly timeoutMs: number;

  constructor(params: {
    key: string | null;
    priority: AnalysisPriority;
    label: string;
    timeoutMs: number;
  }) {
    super(
      `Analysis task timed out after ${params.timeoutMs}ms (queue=${params.label}, priority=${params.priority}, key=${params.key ?? '<none>'})`
    );
    this.name = 'AnalysisTaskTimeoutError';
    this.key = params.key;
    this.priority = params.priority;
    this.label = params.label;
    this.timeoutMs = params.timeoutMs;
  }
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
  private readonly maxUserBypassSlots: number;
  private readonly taskTimeoutMs: number;
  private readonly pending: QueuedTask<unknown>[] = [];
  private readonly runningKeys = new Set<string>();
  // In-flight + pending dedupe map: key -> the resolved promise the caller can
  // await. Cleared once the underlying task settles.
  private readonly inflightByKey = new Map<string, Promise<unknown>>();
  private nextInsertionOrder = 0;
  private active = 0;
  // Item #14 — count of user-priority jobs currently bypassing the
  // concurrency cap. These run on top of `active` regular workers, capped at
  // `maxUserBypassSlots`. When a bypass slot frees, we DON'T immediately
  // start a regular pending task in its place — the cap is for emergency
  // preemption only, not steady-state throughput.
  private userBypassActive = 0;
  // Item #14 — number of currently-running NON-user-priority tasks. Bypass
  // only triggers when at least one of these is holding a regular slot;
  // otherwise a user-priority task waiting behind another user-priority
  // task is just FIFO + concurrency cap as before, no bypass needed.
  private nonUserActive = 0;

  constructor(options: AnalysisQueueOptions) {
    if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
      throw new Error(
        `AnalysisQueue concurrency must be >= 1 (got ${options.concurrency})`
      );
    }
    this.concurrency = Math.floor(options.concurrency);
    this.label = options.label ?? 'analysis-queue';
    this.maxUserBypassSlots = Math.max(0, Math.floor(options.maxUserBypassSlots ?? 3));
    // v3.120 — per-task timeout. 0 / non-finite / negative disables the
    // timer (tests + hot loops); otherwise default to 60s.
    const rawTimeout = options.taskTimeoutMs ?? 60_000;
    this.taskTimeoutMs =
      Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.floor(rawTimeout) : 0;
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
      // After a promote, a user-priority job may now be eligible to bypass
      // the concurrency cap. Re-evaluate the start loop.
      this.maybeStart();
    }
  }

  /**
   * Returns counts useful for tests / debugging.
   */
  stats(): {
    active: number;
    pending: number;
    concurrency: number;
    label: string;
    userBypassActive: number;
  } {
    return {
      active: this.active,
      pending: this.pending.length,
      concurrency: this.concurrency,
      label: this.label,
      userBypassActive: this.userBypassActive,
    };
  }

  /**
   * Item #14 — diagnostic snapshot used by the background-tasks indicator UI
   * in the status sidebar. Returns counts grouped by priority for the pending
   * tasks PLUS the running task counts so the indicator can render
   * "active N / queued M" without poking at internal arrays.
   */
  dump(): {
    label: string;
    concurrency: number;
    active: number;
    userBypassActive: number;
    pending: number;
    pendingByPriority: { user: number; neighbor: number; background: number };
  } {
    let user = 0;
    let neighbor = 0;
    let background = 0;
    for (const p of this.pending) {
      if (p.priority === ANALYSIS_PRIORITY_USER_SELECTED) {
        user += 1;
      } else if (p.priority === ANALYSIS_PRIORITY_NEIGHBOR) {
        neighbor += 1;
      } else {
        background += 1;
      }
    }
    return {
      label: this.label,
      concurrency: this.concurrency,
      active: this.active,
      userBypassActive: this.userBypassActive,
      pending: this.pending.length,
      pendingByPriority: { user, neighbor, background },
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

  private peekHighestPendingPriority(): AnalysisPriority | null {
    if (this.pending.length === 0) {
      return null;
    }
    let best = this.pending[0].priority;
    for (let i = 1; i < this.pending.length; i += 1) {
      if (this.pending[i].priority < best) {
        best = this.pending[i].priority;
      }
    }
    return best;
  }

  private startTask(next: QueuedTask<unknown>, isUserBypass: boolean): void {
    const isNonUser = next.priority !== ANALYSIS_PRIORITY_USER_SELECTED;
    if (isUserBypass) {
      this.userBypassActive += 1;
    } else {
      this.active += 1;
      if (isNonUser) {
        this.nonUserActive += 1;
      }
    }
    if (next.key !== null) {
      this.runningKeys.add(next.key);
    }

    // v3.120 — track-once-and-settle. The timeout path and the natural
    // settle path can race; whichever fires first wins, the other is a
    // silent no-op. Without this guard a task that finishes a hair after
    // the timeout would double-decrement the active counters and confuse
    // the queue.
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      action();

      if (isUserBypass) {
        this.userBypassActive -= 1;
      } else {
        this.active -= 1;
        if (isNonUser) {
          this.nonUserActive -= 1;
        }
      }
      if (next.key !== null) {
        this.runningKeys.delete(next.key);
        this.inflightByKey.delete(next.key);
      }
      this.maybeStart();
    };

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (this.taskTimeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        const error = new AnalysisTaskTimeoutError({
          key: next.key,
          priority: next.priority,
          label: this.label,
          timeoutMs: this.taskTimeoutMs,
        });
        // Surface the timeout so the queue's runtime is observable in
        // production. Use console.warn (not error) so it doesn't poison
        // the renderer error reporter; the caller's promise rejects with
        // the same error shape and that's where the user-visible
        // surfacing happens.
        try {
          // eslint-disable-next-line no-console
          console.warn('[AnalysisQueue] task timeout', {
            label: this.label,
            priority: next.priority,
            key: next.key,
            timeoutMs: this.taskTimeoutMs,
          });
        } catch {
          /* ignore — console.warn shouldn't ever throw, but be safe */
        }
        settle(() => next.reject(error));
      }, this.taskTimeoutMs);
    }

    Promise.resolve()
      .then(() => next.task())
      .then(
        (value) => {
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
          }
          settle(() => next.resolve(value));
        },
        (reason) => {
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
          }
          settle(() => next.reject(reason));
        }
      );
  }

  private maybeStart(): void {
    // Phase 1 — fill regular concurrency slots in priority order.
    while (this.active < this.concurrency && this.pending.length > 0) {
      const next = this.popNext();
      if (!next) {
        return;
      }
      this.startTask(next, false);
    }

    // Phase 2 — Item #14 user-priority bypass. If we have a pending
    // user-priority task AND at least one running task is non-user (i.e. bg
    // or neighbor work is holding a slot), start the user task in an extra
    // bypass slot rather than make it wait. We DO NOT bypass when the slots
    // are all held by other user tasks — that's normal FIFO + cap.
    while (
      this.userBypassActive < this.maxUserBypassSlots &&
      this.nonUserActive > 0 &&
      this.peekHighestPendingPriority() === ANALYSIS_PRIORITY_USER_SELECTED
    ) {
      const next = this.popNext();
      if (!next) {
        return;
      }
      // Sanity: popNext returned a non-user task even though peek said user.
      // Shouldn't happen given the invariant, but guard so we never bypass
      // for non-user work.
      if (next.priority !== ANALYSIS_PRIORITY_USER_SELECTED) {
        // Put it back; let the regular phase pick it up next round.
        this.pending.push(next);
        return;
      }
      this.startTask(next, true);
    }
  }
}
