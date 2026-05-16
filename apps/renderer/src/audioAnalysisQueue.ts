// Priority-aware task pool for audio analysis jobs.
//
// Item #10 (v3.110) — track-switch precompute / cache. We previously serialized
// every analysis job through a single FIFO promise chain (`runSerializedAnalysis`
// in audioAnalysis.ts). That meant the user-priority track had to wait behind
// every queued background-preload job, which made track switching feel slow on
// large albums with rapid switching mid-preload.
//
// Item #14 (v3.118) — bug fix: foreground analysis was still being blocked by
// background precompute. The `promote()` mechanism only re-ordered PENDING
// tasks; if a background task was already running (concurrency=1 preview, or
// both concurrency=2 measured slots full), a user-priority job had to wait for
// the running background job(s) to finish. Later versions added cancellable
// preemption, but the slot was only freed after the aborted task's promise
// rejected. v3.218 makes USER_SELECTED a real interrupt: lower-priority
// cancellable work is synchronously removed from active slots, aborted, and
// requeued so the user task starts in the freed slot immediately.
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
//   - user-priority (0) tasks interrupt lower-priority cancellable work
//     immediately; non-cancellable work falls back to the older bounded bypass
//     path so a click still does not wait behind it
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

export interface AnalysisPriorityCounts {
  user: number;
  neighbor: number;
  background: number;
}

interface QueuedTask<T> {
  key: string | null;
  priority: AnalysisPriority;
  label: string | null;
  insertionOrder: number;
  /**
   * v3.195 — task receives an AbortSignal so callers that support cancellation
   * (notably ffmpeg measured analysis and preview fetch/decode) can react to
   * a USER preemption. Tasks that ignore the signal may keep working until
   * natural settle, but their queue slot is already released for USER work.
   */
  task: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  /**
   * v3.195 — when true, a USER preemption may abort this running task (via
   * the AbortController below) AND requeue it at its current priority so the
   * work isn't lost. When false, the running task is left alone and USER work
   * may use the bounded bypass fallback instead. Default: false (opt-in).
   */
  cancellable: boolean;
  /**
   * v3.195 — controller used to deliver the preemption signal to the task.
   * Created lazily when the task starts; `null` while pending.
   */
  abortController: AbortController | null;
  /**
   * v3.195 — once an external preemption has fired, this is the underlying
   * cause that should be passed to the next instance's reject. We treat the
   * task as "to-be-requeued" rather than "to-be-failed".
   */
  preempted: boolean;
  /**
   * v3.218 — true once preemption has already freed this run's queue slot.
   * The underlying promise may still settle later; settlement must not touch
   * active counters a second time or requeue a duplicate retry.
   */
  releasedForPreemption: boolean;
  /**
   * v3.218 — closure installed by startTask so preemption can synchronously
   * clear the task timeout, release queue bookkeeping, and requeue a retry
   * without waiting for the underlying abort rejection to arrive.
   */
  releaseForPreemption: (() => boolean) | null;
}

/**
 * v3.195 — error used internally to indicate the task was preempted by the
 * queue's USER-preemption pathway. The caller of `enqueue()` does NOT see
 * this; the queue re-enqueues the task at the same priority + key. The
 * underlying task implementation (e.g. ffmpeg child kill path) should react
 * to the AbortSignal and reject with whatever it wants — the queue treats
 * any rejection of a cancelled task as a successful preemption.
 */
export class AnalysisTaskPreemptedError extends Error {
  public readonly key: string | null;

  constructor(key: string | null) {
    super(
      `Analysis task preempted by USER priority (key=${key ?? '<none>'})`
    );
    this.name = 'AnalysisTaskPreemptedError';
    this.key = key;
  }
}

export interface AnalysisQueueJobSnapshot {
  key: string | null;
  priority: AnalysisPriority;
  label: string | null;
  slot: 'regular' | 'user-bypass';
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
  /**
   * v3.207 — cold-start grace timeout. The wall-clock budget used for tasks
   * that start BEFORE this queue has observed its first successful task
   * settlement in this process lifetime. Once any task in this queue resolves
   * successfully (rejection / preemption / timeout do NOT count), the queue
   * "warms up" and subsequent tasks use the normal `taskTimeoutMs` budget.
   *
   * Why this exists: on a fresh OS boot / first launch after auto-update,
   * macOS runs code-sign verification + Gatekeeper + dyld cache rebuild +
   * disk pre-warm in parallel with the renderer's startup warmup analyses.
   * Empirically the first ~6 USER_SELECTED measured/preview analyses can
   * all exceed 60s under that load — they all time out exactly at +60s,
   * leaving the user staring at "Analysis task timed out" toasts even though
   * the underlying ffmpeg/decodeAudioData call is making progress in the
   * background. By the time the user clicks a second track manually, the
   * binary cache + AudioContext are warm and analyses return in <5s. This
   * grace window covers the cold-start race without weakening the steady-
   * state timeout (the timeout still catches genuinely-stuck tasks once the
   * process is warm).
   *
   * Default: 3× `taskTimeoutMs` (180s when `taskTimeoutMs` is the default
   * 60s). Set to `0` to disable cold-start grace and always use the normal
   * timeout (tests use `0`). Setting this lower than `taskTimeoutMs` is
   * permitted but unusual.
   */
  coldStartTimeoutMs?: number;
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


function sanitizeJobLabel(label: string | undefined): string | null {
  if (typeof label !== 'string') {
    return null;
  }
  const trimmed = label.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed.slice(0, 160) : null;
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
  /**
   * v3.145 — short human-readable job label for status/debug UI.
   * Examples: "Alpha v2.wav" or "Reference — Pro Master.wav". The queue
   * still de-dupes by key; this label is display-only and never participates
   * in scheduling decisions.
   */
  label?: string;
  /**
   * v3.195 — when true, this task can be aborted + requeued by the queue if a
   * USER-priority task arrives while it is running. The task is responsible
   * for honoring its AbortSignal (e.g. by killing a child process). The
   * queue will silently requeue cancelled tasks at their original priority.
   *
   * Default: false. Opt-in for analysis paths that can react to cancellation
   * (ffmpeg kills its child process; preview analysis aborts fetch and closes
   * its AudioContext).
   */
  cancellable?: boolean;
}

export class AnalysisQueue {
  private readonly concurrency: number;
  private readonly label: string;
  private readonly maxUserBypassSlots: number;
  private readonly taskTimeoutMs: number;
  // v3.207 — cold-start grace. See AnalysisQueueOptions.coldStartTimeoutMs.
  private readonly coldStartTimeoutMs: number;
  // v3.207 — flips to true after the FIRST successfully-resolved task in this
  // queue's process lifetime. Failures, timeouts, and preemptions do NOT mark
  // the queue as warm — only a real resolve does, because that's the proof
  // the underlying analysis runtime (ffmpeg / AudioContext / IPC bridge) is
  // actually responsive on this machine in this process. Subsequent tasks
  // use `taskTimeoutMs` rather than `coldStartTimeoutMs`.
  private firstSuccessSettled = false;
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
  // Diagnostic/cooperative-scheduling counts. Unlike `active` and
  // `userBypassActive`, this records WHAT priority is currently running,
  // regardless of whether the task is in a regular slot or a bypass slot.
  private readonly activeByPriority: AnalysisPriorityCounts = {
    user: 0,
    neighbor: 0,
    background: 0,
  };
  // Diagnostic-only totals used by E2E to prove startup warmup is not being
  // silently routed through the optional BACKGROUND bucket. A fresh Electron
  // launch resets these process-lifetime counters.
  private readonly totalEnqueuedByPriority: AnalysisPriorityCounts = {
    user: 0,
    neighbor: 0,
    background: 0,
  };
  private readonly runningTasks = new Map<
    QueuedTask<unknown>,
    'regular' | 'user-bypass'
  >();

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
    // v3.207 — cold-start grace timeout. If the option is omitted, default to
    // 3× the normal timeout (covers the cold-start race on a fresh restart /
    // post-auto-update launch). 0 disables the grace window entirely so tests
    // can stay deterministic with the normal timeout. If the caller explicitly
    // set `taskTimeoutMs: 0`, cold-start grace is also disabled — a queue with
    // no timeout at all has nothing to extend.
    if (this.taskTimeoutMs === 0) {
      this.coldStartTimeoutMs = 0;
    } else {
      const rawColdStart = options.coldStartTimeoutMs ?? this.taskTimeoutMs * 3;
      this.coldStartTimeoutMs =
        Number.isFinite(rawColdStart) && rawColdStart > 0
          ? Math.floor(rawColdStart)
          : 0;
    }
  }

  /**
   * v3.207 — diagnostic helper. Tests use this to assert cold-start vs warm
   * timeout selection. Returns the timeout that WILL be applied to the next
   * task to start.
   */
  public getEffectiveTimeoutMs(): number {
    if (this.taskTimeoutMs === 0) {
      return 0;
    }
    if (this.coldStartTimeoutMs > 0 && !this.firstSuccessSettled) {
      return this.coldStartTimeoutMs;
    }
    return this.taskTimeoutMs;
  }

  /**
   * v3.207 — diagnostic helper. True once any task has resolved successfully
   * in this queue's process lifetime; thereafter the cold-start grace window
   * no longer applies.
   */
  public isWarm(): boolean {
    return this.firstSuccessSettled;
  }

  /**
   * Enqueue a task. Returns a promise that settles when the task runs.
   *
   * Identical `key` values short-circuit to the existing in-flight or pending
   * task — useful when both a background preloader and a user-selection effect
   * race for the same track on near-simultaneous renders.
   */
  enqueue<T>(
    task: ((signal: AbortSignal) => Promise<T>) | (() => Promise<T>),
    options: EnqueueOptions = {}
  ): Promise<T> {
    const priority = options.priority ?? ANALYSIS_PRIORITY_BACKGROUND;
    const key = options.key ?? null;
    const label = sanitizeJobLabel(options.label);
    const cancellable = options.cancellable === true;

    if (key !== null) {
      const existing = this.inflightByKey.get(key);
      if (existing) {
        // Promote the existing task if the caller asked for a higher priority.
        // No-op if it's already running.
        this.promote(key, priority);
        if (label !== null) {
          this.updatePendingLabel(key, label);
        }
        return existing as Promise<T>;
      }
    }

    if (priority === ANALYSIS_PRIORITY_USER_SELECTED) {
      this.totalEnqueuedByPriority.user += 1;
    } else if (priority === ANALYSIS_PRIORITY_NEIGHBOR) {
      this.totalEnqueuedByPriority.neighbor += 1;
    } else {
      this.totalEnqueuedByPriority.background += 1;
    }

    return new Promise<T>((resolve, reject) => {
      const queued: QueuedTask<T> = {
        key,
        priority,
        label,
        insertionOrder: this.nextInsertionOrder++,
        // Wrap legacy 0-arg tasks so they ignore the signal silently.
        task: task as (signal: AbortSignal) => Promise<T>,
        resolve,
        reject,
        cancellable,
        abortController: null,
        preempted: false,
        releasedForPreemption: false,
        releaseForPreemption: null,
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
    let changed = false;

    for (const [runningTask, slot] of this.runningTasks.entries()) {
      if (runningTask.key !== key) continue;
      if (priority >= runningTask.priority) continue;

      const wasNonUser = runningTask.priority !== ANALYSIS_PRIORITY_USER_SELECTED;
      const isNowUser = priority === ANALYSIS_PRIORITY_USER_SELECTED;
      const oldBucket = this.priorityBucket(runningTask.priority);
      const newBucket = this.priorityBucket(priority);

      runningTask.priority = priority;
      this.activeByPriority[oldBucket] -= 1;
      this.activeByPriority[newBucket] += 1;

      if (slot === 'regular' && wasNonUser && isNowUser) {
        this.nonUserActive -= 1;
      }

      changed = true;
    }

    if (!this.runningKeys.has(key)) {
      for (const task of this.pending) {
        if (task.key === key && priority < task.priority) {
          task.priority = priority;
          changed = true;
        }
      }
    }

    if (changed) {
      // After a promote, a user-priority job may now be eligible to interrupt
      // lower-priority running work, or to start in a regular/bypass slot.
      this.maybeStart();
    }
  }

  /**
   * v3.190 — Rapid-switch demotion. Lower priority value = runs sooner; a
   * higher priority value here means "this is now LESS urgent than before".
   *
   * When the user clicks song A then song B in rapid succession, A's
   * USER_SELECTED queue entry is now stale: B is what they're actually
   * waiting for. If A's job is still PENDING, we demote it (e.g. to
   * NEIGHBOR) so it stops competing with B for a bypass slot. If A's job is
   * already RUNNING, we mark it non-user so a newer USER click can interrupt
   * it if the task is cancellable (or bypass it if not).
   *
   * Semantics:
   *   - If the keyed task is pending and the new priority is HIGHER (numeric
   *     value greater), update the task's priority and re-evaluate the start
   *     loop. No-op if new priority is lower or equal (use `promote` for
   *     that direction).
   *   - If the keyed task is running, we update bookkeeping so the slot
   *     accounting reflects the new priority bucket. The task itself keeps
   *     running until a later USER enqueue decides whether to interrupt it.
   *   - No-op if the key is not known.
   *
   * Returns true if any in-flight or pending task was affected.
   */
  demote(key: string, priority: AnalysisPriority): boolean {
    let changed = false;

    // Pending tasks: lower the priority if we're moving it DOWN
    // (numeric value greater).
    for (const task of this.pending) {
      if (task.key === key && priority > task.priority) {
        task.priority = priority;
        changed = true;
      }
    }

    // Running tasks: update bookkeeping so subsequent maybeStart() decisions
    // see the correct counts. A later USER enqueue can now preempt this
    // demoted task if it is cancellable.
    for (const [runningTask, slot] of this.runningTasks.entries()) {
      if (runningTask.key !== key) continue;
      if (priority <= runningTask.priority) continue;

      const wasUser = runningTask.priority === ANALYSIS_PRIORITY_USER_SELECTED;
      const isNowUser = priority === ANALYSIS_PRIORITY_USER_SELECTED;
      const oldBucket = this.priorityBucket(runningTask.priority);
      const newBucket = this.priorityBucket(priority);

      runningTask.priority = priority;
      this.activeByPriority[oldBucket] -= 1;
      this.activeByPriority[newBucket] += 1;

      // Bypass-slot accounting: a demoted user task that was occupying a
      // bypass slot is now effectively a regular slot's worth of work, but
      // since it was started as a bypass, the slot frees the bypass counter
      // and increments active/regular counters so the next click can bypass
      // again.
      if (wasUser && !isNowUser) {
        if (slot === 'user-bypass') {
          this.userBypassActive -= 1;
          this.active += 1;
          this.nonUserActive += 1;
          this.runningTasks.set(runningTask, 'regular');
        } else {
          // Was running in a regular slot at user priority — flip to non-user.
          this.nonUserActive += 1;
        }
      }

      changed = true;
    }

    if (changed) {
      this.maybeStart();
    }
    return changed;
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
    runningJobs: AnalysisQueueJobSnapshot[];
    activeByPriority: AnalysisPriorityCounts;
    pendingByPriority: AnalysisPriorityCounts;
    totalEnqueuedByPriority: AnalysisPriorityCounts;
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
      runningJobs: Array.from(this.runningTasks.entries()).map(([task, slot]) => ({
        key: task.key,
        priority: task.priority,
        label: task.label,
        slot,
      })),
      activeByPriority: { ...this.activeByPriority },
      pendingByPriority: { user, neighbor, background },
      totalEnqueuedByPriority: { ...this.totalEnqueuedByPriority },
    };
  }

  private updatePendingLabel(key: string, label: string): void {
    for (const task of this.pending) {
      if (task.key === key && task.label === null) {
        task.label = label;
      }
    }
  }

  private priorityBucket(priority: AnalysisPriority): keyof AnalysisPriorityCounts {
    if (priority === ANALYSIS_PRIORITY_USER_SELECTED) {
      return 'user';
    }
    if (priority === ANALYSIS_PRIORITY_NEIGHBOR) {
      return 'neighbor';
    }
    return 'background';
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

  private popNextWithPriority(
    priority: AnalysisPriority
  ): QueuedTask<unknown> | undefined {
    let bestIndex = -1;
    for (let i = 0; i < this.pending.length; i += 1) {
      const task = this.pending[i];
      if (task.priority !== priority) {
        continue;
      }
      if (
        bestIndex === -1 ||
        this.comparePending(task, this.pending[bestIndex]) < 0
      ) {
        bestIndex = i;
      }
    }
    if (bestIndex === -1) {
      return undefined;
    }
    const [next] = this.pending.splice(bestIndex, 1);
    return next;
  }

  private popNextRegularSlotTask(): QueuedTask<unknown> | undefined {
    if (this.activeByPriority.user > 0) {
      return this.popNextWithPriority(ANALYSIS_PRIORITY_USER_SELECTED);
    }
    return this.popNext();
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

  private hasUserPriorityWork(): boolean {
    return (
      this.activeByPriority.user > 0 ||
      this.peekHighestPendingPriority() === ANALYSIS_PRIORITY_USER_SELECTED
    );
  }

  private releaseRunningTask(next: QueuedTask<unknown>): void {
    const currentSlot = this.runningTasks.get(next);
    if (!currentSlot) {
      return;
    }

    const currentBucket = this.priorityBucket(next.priority);
    const currentIsNonUser = next.priority !== ANALYSIS_PRIORITY_USER_SELECTED;

    if (currentSlot === 'user-bypass') {
      this.userBypassActive -= 1;
    } else {
      this.active -= 1;
      if (currentIsNonUser) {
        this.nonUserActive -= 1;
      }
    }
    this.activeByPriority[currentBucket] -= 1;
    this.runningTasks.delete(next);
    if (next.key !== null) {
      this.runningKeys.delete(next.key);
    }
  }

  private startTask(next: QueuedTask<unknown>, isUserBypass: boolean): void {
    next.releasedForPreemption = false;
    next.releaseForPreemption = null;
    const isNonUser = next.priority !== ANALYSIS_PRIORITY_USER_SELECTED;
    const activePriorityBucket = this.priorityBucket(next.priority);
    if (isUserBypass) {
      this.userBypassActive += 1;
    } else {
      this.active += 1;
      if (isNonUser) {
        this.nonUserActive += 1;
      }
    }
    this.activeByPriority[activePriorityBucket] += 1;
    this.runningTasks.set(next, isUserBypass ? 'user-bypass' : 'regular');
    if (next.key !== null) {
      this.runningKeys.add(next.key);
    }

    // v3.195 — Each task gets its own AbortController. Cancellable tasks honor
    // the signal (e.g. ffmpeg path kills the child process and rejects). Non-
    // cancellable tasks may ignore it.
    next.abortController = new AbortController();
    const abortSignal = next.abortController.signal;

    // v3.120 — track-once-and-settle. The timeout path and the natural
    // settle path can race; whichever fires first wins, the other is a
    // silent no-op. Without this guard a task that finishes a hair after
    // the timeout would double-decrement the active counters and confuse
    // the queue.
    //
    // v3.190 — settle() now reads slot + priority from the LIVE state
    // (runningTasks + task.priority) rather than start-time closure
    // captures. This is required for `demote()` correctness: a task that
    // started as user-priority but was demoted mid-flight may have been
    // moved from a bypass slot to a regular slot, and the bookkeeping has
    // to unwind whatever its CURRENT slot is, not what it was when it
    // started.
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      action();

      if (!next.releasedForPreemption) {
        this.releaseRunningTask(next);
      }
      next.releaseForPreemption = null;
      if (next.key !== null) {
        // v3.201 — Finding 4 fix: when a task is being preempted + requeued,
        // we MUST keep its inflightByKey entry alive across the cancel so
        // that a rapid second enqueue for the same key dedupes to the SAME
        // (still-pending) caller promise instead of spawning a parallel
        // duplicate. The dedupePromise's resolve/reject wrappers are still
        // wired to this queued task's resolve/reject, which the requeued
        // run will eventually call. The dedupe entry gets cleared on the
        // next settle (when the requeued task finally completes — at that
        // point next.preempted has been reset to false by requeue).
        if (!next.preempted) {
          this.inflightByKey.delete(next.key);
        }
      }
      this.maybeStart();
    };

    // v3.207 — choose effective timeout: cold-start grace window applies
    // until the queue has observed its first successful task settlement, then
    // we revert to the normal `taskTimeoutMs`. See coldStartTimeoutMs docs.
    const effectiveTimeoutMs =
      this.coldStartTimeoutMs > 0 && !this.firstSuccessSettled
        ? this.coldStartTimeoutMs
        : this.taskTimeoutMs;
    const usingColdStartGrace =
      this.coldStartTimeoutMs > 0 &&
      !this.firstSuccessSettled &&
      this.coldStartTimeoutMs !== this.taskTimeoutMs;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (effectiveTimeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        const error = new AnalysisTaskTimeoutError({
          key: next.key,
          priority: next.priority,
          label: this.label,
          timeoutMs: effectiveTimeoutMs,
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
            timeoutMs: effectiveTimeoutMs,
            coldStartGrace: usingColdStartGrace,
          });
        } catch {
          /* ignore — console.warn shouldn't ever throw, but be safe */
        }
        settle(() => next.reject(error));
      }, effectiveTimeoutMs);
    }

    next.releaseForPreemption = (): boolean => {
      if (settled || next.releasedForPreemption) {
        return false;
      }
      next.preempted = true;
      next.releasedForPreemption = true;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      this.releaseRunningTask(next);
      this.requeuePreemptedTask(next);
      return true;
    };

    Promise.resolve()
      .then(() => next.task(abortSignal))
      .then(
        (value) => {
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
          }
          // v3.207 — the FIRST successful resolve in this process lifetime
          // proves the underlying analysis runtime is responsive on this
          // machine, so subsequent tasks can use the normal (shorter)
          // `taskTimeoutMs` rather than the cold-start grace window. Failures,
          // timeouts, and preemptions do NOT mark the queue warm — they're
          // ambiguous wrt runtime health (could be the binary, could be
          // genuine "stuck forever" mode, could be cancellation).
          //
          // v3.208 — Codex review fix: only flip warm if the caller actually
          // saw this success. If `settled` is already true (timeout fired
          // first and the caller was rejected with AnalysisTaskTimeoutError),
          // OR the task was preempted, the late natural resolve is NOT
          // observable runtime health proof to the caller. Setting
          // firstSuccessSettled unconditionally meant a cold-start task that
          // timed out, then resolved 30s later in the background, would
          // incorrectly mark the queue warm even though the user saw a
          // timeout. Guard on `!settled && !next.preempted`.
          if (!settled && !next.preempted) {
            this.firstSuccessSettled = true;
          }
          // v3.195 — if a value comes back AFTER preemption fired (the task
          // ignored the abort signal and finished naturally) we still treat
          // the slot release as a settle. The caller's promise was kept
          // alive; we resolve with the late value.
          settle(() => {
            if (next.preempted) {
              // Treat as if the requeued task will pick this up — but the
              // value is still useful; pass it through.
              next.resolve(value);
            } else {
              next.resolve(value);
            }
          });
        },
        (reason) => {
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
          }
          // v3.195 — preemption rejection path. If the task was preempted
          // (we aborted its signal) and it then rejected, we silently
          // requeue rather than propagating the rejection. The caller's
          // original promise stays pending until the requeued instance
          // settles.
          if (next.preempted) {
            settle(() => {
              if (!next.releasedForPreemption) {
                this.requeuePreemptedTask(next);
              }
            });
            return;
          }
          settle(() => next.reject(reason));
        }
      );
  }

  /**
   * v3.195 — Re-insert a preempted task at the front of its priority bucket so
   * it runs again after the USER work completes. The original
   * resolve/reject closures are preserved so the caller's promise still
   * settles with the eventual result.
   */
  private requeuePreemptedTask(task: QueuedTask<unknown>): void {
    // Clone rather than reusing the still-settling task object. v3.218 can
    // requeue immediately at abort time, before the old promise has rejected;
    // the old run must remain marked preempted so its eventual settle is a
    // no-op, while the retry gets fresh abort/bookkeeping state.
    const retry: QueuedTask<unknown> = {
      ...task,
      abortController: null,
      preempted: false,
      releasedForPreemption: false,
      releaseForPreemption: null,
    };
    // Re-insert at the FRONT of insertion order within its priority bucket:
    // we use a fresh insertionOrder that sorts AFTER currently-pending tasks
    // at the same priority but BEFORE tasks at strictly LOWER priority. The
    // simplest correct choice is the head of the bucket — give it a negative
    // insertion order so it wins same-priority FIFO against newer entries.
    // Since insertion order is monotonically increasing, decrement below the
    // current min.
    retry.insertionOrder = this.computeRequeueInsertionOrder();
    this.pending.push(retry);
  }

  private computeRequeueInsertionOrder(): number {
    let min = 0;
    for (const t of this.pending) {
      if (t.insertionOrder < min) {
        min = t.insertionOrder;
      }
    }
    return min - 1;
  }

  /**
   * v3.218 — Preempt all running NEIGHBOR/BG tasks that are cancellable as
   * soon as USER work is pending or active. Slot bookkeeping is released
   * synchronously; the underlying task receives AbortSignal immediately and
   * its caller-facing promise stays pending for the retry.
   *
   * Returns the number of tasks preempted.
   */
  private preemptCancellableForUser(): number {
    if (!this.hasUserPriorityWork()) {
      return 0;
    }

    let preempted = 0;
    // Iterate cancellable non-user tasks in REVERSE priority order
    // (background first, then neighbor) so user clicks preempt the lowest-
    // value work first.
    const candidates: QueuedTask<unknown>[] = [];
    for (const [runningTask, slot] of this.runningTasks.entries()) {
      if (slot !== 'regular') continue;
      if (runningTask.priority === ANALYSIS_PRIORITY_USER_SELECTED) continue;
      if (!runningTask.cancellable) continue;
      if (runningTask.preempted) continue;
      candidates.push(runningTask);
    }
    candidates.sort((a, b) => b.priority - a.priority);

    for (const candidate of candidates) {
      const released = candidate.releaseForPreemption?.() ?? false;
      if (!released) {
        continue;
      }
      try {
        candidate.abortController?.abort();
      } catch {
        // Aborting a controller is meant to be infallible; swallow as a
        // defensive precaution.
      }
      preempted += 1;
    }
    return preempted;
  }

  private maybeStart(): void {
    // Phase 0 — true interrupt. If USER work exists, synchronously evict all
    // cancellable lower-priority regular-slot tasks before admitting anything
    // else. This frees CPU/memory pressure immediately instead of waiting for
    // an async AbortError to unwind.
    this.preemptCancellableForUser();

    // Phase 1 — fill regular concurrency slots in priority order.
    while (this.active < this.concurrency && this.pending.length > 0) {
      const next = this.popNextRegularSlotTask();
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
