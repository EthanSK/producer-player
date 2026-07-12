import { describe, expect, it, vi } from 'vitest';
import {
  AnalysisQueue,
  AnalysisTaskPreemptedError,
  AnalysisTaskTimeoutError,
  ANALYSIS_PRIORITY_BACKGROUND,
  ANALYSIS_PRIORITY_NEIGHBOR,
  ANALYSIS_PRIORITY_USER_SELECTED,
} from './audioAnalysisQueue';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times: number = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- intentional, drains microtasks
    await Promise.resolve();
  }
}

describe('AnalysisQueue', () => {
  it('runs tasks sequentially when concurrency is 1', async () => {
    const queue = new AnalysisQueue({ concurrency: 1, label: 'test' });
    const order: string[] = [];

    const a = deferred<string>();
    const b = deferred<string>();

    const p1 = queue.enqueue(async () => {
      order.push('a:start');
      const v = await a.promise;
      order.push('a:end');
      return v;
    });

    const p2 = queue.enqueue(async () => {
      order.push('b:start');
      const v = await b.promise;
      order.push('b:end');
      return v;
    });

    await flushMicrotasks();
    expect(order).toEqual(['a:start']);

    a.resolve('A');
    await flushMicrotasks();
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);

    b.resolve('B');
    await expect(p1).resolves.toBe('A');
    await expect(p2).resolves.toBe('B');
  });

  it('enforces a concurrency cap > 1', async () => {
    const queue = new AnalysisQueue({ concurrency: 2 });

    const d1 = deferred<number>();
    const d2 = deferred<number>();
    const d3 = deferred<number>();
    const d4 = deferred<number>();

    let inflight = 0;
    let peak = 0;

    const wrap = (d: ReturnType<typeof deferred<number>>) =>
      queue.enqueue(async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        const v = await d.promise;
        inflight -= 1;
        return v;
      });

    const p1 = wrap(d1);
    const p2 = wrap(d2);
    const p3 = wrap(d3);
    const p4 = wrap(d4);

    await flushMicrotasks();
    expect(inflight).toBe(2);

    d1.resolve(1);
    await flushMicrotasks();
    expect(inflight).toBe(2);

    d2.resolve(2);
    d3.resolve(3);
    d4.resolve(4);

    await Promise.all([p1, p2, p3, p4]);
    expect(peak).toBe(2);
  });

  it('prioritizes lower priority values over higher ones', async () => {
    // Construct WITHOUT user-priority bypass so this test exercises pure
    // FIFO-with-priority. The bypass behavior is covered separately below.
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 0 });
    const order: string[] = [];

    const blocker = deferred<void>();
    // First task occupies the worker; everything else queues.
    const p0 = queue.enqueue(async () => {
      order.push('blocker:start');
      await blocker.promise;
      order.push('blocker:end');
    });

    // Enqueue background, then neighbor, then user-selected.
    const pBg = queue.enqueue(async () => {
      order.push('bg');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

    const pNb = queue.enqueue(async () => {
      order.push('neighbor');
    }, { priority: ANALYSIS_PRIORITY_NEIGHBOR });

    const pUser = queue.enqueue(async () => {
      order.push('user');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });

    blocker.resolve();
    await Promise.all([p0, pBg, pNb, pUser]);

    // After the blocker finishes, the queue should drain in priority order:
    // user (0) -> neighbor (1) -> bg (2).
    expect(order).toEqual([
      'blocker:start',
      'blocker:end',
      'user',
      'neighbor',
      'bg',
    ]);
  });

  it('runs same-priority tasks FIFO', async () => {
    const queue = new AnalysisQueue({ concurrency: 1 });
    const order: number[] = [];
    const blocker = deferred<void>();

    const blockerPromise = queue.enqueue(async () => {
      await blocker.promise;
    });

    const tasks = [1, 2, 3, 4].map((n) =>
      queue.enqueue(async () => {
        order.push(n);
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND })
    );

    blocker.resolve();
    await blockerPromise;
    await Promise.all(tasks);

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('dedupes by key — the same key returns the in-flight promise', async () => {
    const queue = new AnalysisQueue({ concurrency: 1 });
    const taskFn = vi.fn(async () => 'result');

    const p1 = queue.enqueue(taskFn, { key: 'track-A' });
    const p2 = queue.enqueue(taskFn, { key: 'track-A' });

    expect(p2).toBe(p1);
    await Promise.all([p1, p2]);

    expect(taskFn).toHaveBeenCalledTimes(1);
    await expect(p1).resolves.toBe('result');
    await expect(p2).resolves.toBe('result');
  });

  it('uses the caller promise as the keyed rejection promise', async () => {
    const queue = new AnalysisQueue({ concurrency: 1 });
    const failure = new DOMException('playback started', 'AbortError');

    const p1 = queue.enqueue(async () => {
      throw failure;
    }, { key: 'cancelled-track' });
    const p2 = queue.enqueue(async () => 'should-not-run', {
      key: 'cancelled-track',
    });

    // Catching the returned promise must catch the queue's only rejection;
    // there must not be a second, ownerless dedupe promise left to become an
    // unhandled rejection on the next event-loop turn.
    expect(p2).toBe(p1);
    await expect(p1).rejects.toBe(failure);
  });

  it('promotes a queued task to a higher priority', async () => {
    const queue = new AnalysisQueue({ concurrency: 1 });
    const order: string[] = [];
    const blocker = deferred<void>();

    const blockerPromise = queue.enqueue(async () => {
      await blocker.promise;
    });

    queue.enqueue(async () => {
      order.push('a');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND, key: 'A' });
    queue.enqueue(async () => {
      order.push('b');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND, key: 'B' });
    queue.enqueue(async () => {
      order.push('c');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND, key: 'C' });

    // Promote C to user-selected priority — should run BEFORE A and B.
    queue.promote('C', ANALYSIS_PRIORITY_USER_SELECTED);

    blocker.resolve();
    await blockerPromise;
    // wait for queue to drain
    while (queue.stats().active > 0 || queue.stats().pending > 0) {
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks();
    }

    expect(order).toEqual(['c', 'a', 'b']);
  });

  it('isolates errors — failed task does not break the queue', async () => {
    const queue = new AnalysisQueue({ concurrency: 1 });
    const order: string[] = [];

    const failing = queue.enqueue(async () => {
      order.push('fail');
      throw new Error('nope');
    });

    const ok = queue.enqueue(async () => {
      order.push('ok');
      return 42;
    });

    await expect(failing).rejects.toThrow('nope');
    await expect(ok).resolves.toBe(42);
    expect(order).toEqual(['fail', 'ok']);
  });

  it('rejects invalid concurrency', () => {
    expect(() => new AnalysisQueue({ concurrency: 0 })).toThrow();
    expect(() => new AnalysisQueue({ concurrency: -1 })).toThrow();
    expect(() => new AnalysisQueue({ concurrency: Number.NaN })).toThrow();
  });

  it('promote() is a no-op for already-running tasks', async () => {
    const queue = new AnalysisQueue({ concurrency: 1 });
    const order: string[] = [];
    const a = deferred<void>();

    const p1 = queue.enqueue(async () => {
      order.push('a:start');
      await a.promise;
      order.push('a:end');
    }, { key: 'A' });

    const p2 = queue.enqueue(async () => {
      order.push('b');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND, key: 'B' });

    // Wait for A to start
    await flushMicrotasks();
    expect(order).toEqual(['a:start']);

    // Promote A — already running; should be ignored without crashing.
    queue.promote('A', ANALYSIS_PRIORITY_USER_SELECTED);

    a.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  // --- Item #14 (v3.118) — user-priority bypass / preemption tests ---

  it('lets a user-priority task bypass the concurrency cap when bg tasks are running', async () => {
    // Item #14 regression: the previous queue made user-priority work wait
    // behind any in-flight bg task. With concurrency=1 + a bg job already
    // running, a user-priority enqueue had to wait until the bg job
    // finished — which is exactly what blocked version-history / LUFS /
    // sample rate from loading after a click. The fix: user-priority
    // enqueues bypass the cap up to maxUserBypassSlots.
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 3 });
    const order: string[] = [];

    const bg = deferred<void>();
    const bgPromise = queue.enqueue(async () => {
      order.push('bg:start');
      await bg.promise;
      order.push('bg:end');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND, key: 'bg' });

    await flushMicrotasks();
    expect(order).toEqual(['bg:start']);
    expect(queue.stats().active).toBe(1);

    // User clicks a track mid-bg. Should run NOW, not wait for bg:end.
    const userPromise = queue.enqueue(async () => {
      order.push('user');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'user' });

    await flushMicrotasks();
    // The user task should already have executed despite the bg task still
    // holding the regular slot.
    expect(order).toEqual(['bg:start', 'user']);
    expect(queue.stats().userBypassActive).toBe(0); // settled

    bg.resolve();
    await Promise.all([bgPromise, userPromise]);
    expect(order).toEqual(['bg:start', 'user', 'bg:end']);
  });

  it('does not bypass when there are no lower-priority tasks holding slots', async () => {
    // If only user-priority tasks are in flight, additional user enqueues
    // should respect the concurrency cap (no point bypassing — they're not
    // racing against bg work).
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 3 });
    const order: string[] = [];

    const u1 = deferred<void>();
    const u1Promise = queue.enqueue(async () => {
      order.push('u1:start');
      await u1.promise;
      order.push('u1:end');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });

    await flushMicrotasks();
    expect(order).toEqual(['u1:start']);

    const u2Promise = queue.enqueue(async () => {
      order.push('u2');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });

    await flushMicrotasks();
    // u2 should NOT have run yet because the slot is held by another
    // user-priority task — bypass is only for preempting bg work.
    expect(order).toEqual(['u1:start']);

    u1.resolve();
    await Promise.all([u1Promise, u2Promise]);
    expect(order).toEqual(['u1:start', 'u1:end', 'u2']);
  });

  it('caps bypass at maxUserBypassSlots so a click storm does not OOM', async () => {
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 2 });
    const order: string[] = [];

    const bg = deferred<void>();
    queue.enqueue(async () => {
      order.push('bg:start');
      await bg.promise;
      order.push('bg:end');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

    await flushMicrotasks();
    expect(order).toEqual(['bg:start']);

    const user1 = deferred<void>();
    const user2 = deferred<void>();
    const user3 = deferred<void>();

    const u1 = queue.enqueue(async () => {
      order.push('u1:start');
      await user1.promise;
      order.push('u1:end');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });
    const u2 = queue.enqueue(async () => {
      order.push('u2:start');
      await user2.promise;
      order.push('u2:end');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });
    const u3 = queue.enqueue(async () => {
      order.push('u3:start');
      await user3.promise;
      order.push('u3:end');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });

    await flushMicrotasks();
    // u1 + u2 should both bypass (cap=2). u3 must wait until a bypass slot
    // frees OR the bg slot frees.
    expect(order).toEqual(['bg:start', 'u1:start', 'u2:start']);
    expect(queue.stats().userBypassActive).toBe(2);

    user1.resolve();
    await flushMicrotasks();
    // u3 picks up the freed bypass slot.
    expect(order).toContain('u3:start');

    user2.resolve();
    user3.resolve();
    bg.resolve();
    await Promise.all([u1, u2, u3]);
  });

  it('prefers higher-priority pending tasks over user-bypass when a regular slot frees', async () => {
    // When a bg task finishes and there's a queued neighbor + queued user,
    // the regular fill loop runs first (priority order, user wins) so we
    // don't pointlessly bypass.
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 3 });
    const order: string[] = [];
    const bg = deferred<void>();

    queue.enqueue(async () => {
      order.push('bg:start');
      await bg.promise;
      order.push('bg:end');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

    await flushMicrotasks();
    expect(order).toEqual(['bg:start']);

    // Enqueue neighbor THEN user. User should run via bypass immediately;
    // neighbor waits for the bg slot to free.
    const neighborPromise = queue.enqueue(async () => {
      order.push('neighbor');
    }, { priority: ANALYSIS_PRIORITY_NEIGHBOR });
    const userPromise = queue.enqueue(async () => {
      order.push('user');
    }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });

    await flushMicrotasks();
    // user bypassed; neighbor still pending.
    expect(order).toEqual(['bg:start', 'user']);

    bg.resolve();
    await Promise.all([userPromise, neighborPromise]);
    expect(order).toEqual(['bg:start', 'user', 'bg:end', 'neighbor']);
  });

  it('promote() into user priority unblocks a waiting click via bypass', async () => {
    // When the user clicks a track that was already enqueued at bg priority,
    // App.tsx calls promote(key, USER_SELECTED). After promote, the queue
    // should re-evaluate and bypass-start it if all regular slots are bg.
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 3 });
    const order: string[] = [];
    const blocker = deferred<void>();
    const targetGate = deferred<void>();

    queue.enqueue(async () => {
      order.push('blocker:start');
      await blocker.promise;
      order.push('blocker:end');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

    queue.enqueue(async () => {
      order.push('target:start');
      await targetGate.promise;
      order.push('target:end');
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND, key: 'target' });

    await flushMicrotasks();
    expect(order).toEqual(['blocker:start']);

    // Promote — should kick off via bypass without waiting for blocker.
    queue.promote('target', ANALYSIS_PRIORITY_USER_SELECTED);
    await flushMicrotasks();
    expect(order).toEqual(['blocker:start', 'target:start']);

    targetGate.resolve();
    blocker.resolve();
    await flushMicrotasks();
  });

  it('dump() reports per-priority pending counts for the indicator UI', async () => {
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 0 });
    const blocker = deferred<void>();

    queue.enqueue(async () => {
      await blocker.promise;
    }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

    queue.enqueue(async () => undefined, { priority: ANALYSIS_PRIORITY_BACKGROUND });
    queue.enqueue(async () => undefined, { priority: ANALYSIS_PRIORITY_NEIGHBOR });
    queue.enqueue(async () => undefined, { priority: ANALYSIS_PRIORITY_USER_SELECTED });
    queue.enqueue(async () => undefined, { priority: ANALYSIS_PRIORITY_USER_SELECTED });

    await flushMicrotasks();

    const snap = queue.dump();
    expect(snap.active).toBe(1);
    expect(snap.pending).toBe(4);
    expect(snap.activeByPriority).toEqual({ user: 0, neighbor: 0, background: 1 });
    expect(snap.pendingByPriority).toEqual({ user: 2, neighbor: 1, background: 1 });
    expect(snap.userBypassActive).toBe(0);

    blocker.resolve();
    while (queue.stats().active > 0 || queue.stats().pending > 0) {
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks();
    }
  });

  it('dump() exposes labels for currently running jobs', async () => {
    const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 1 });
    const backgroundGate = deferred<void>();
    const userGate = deferred<void>();

    const background = queue.enqueue(
      async () => {
        await backgroundGate.promise;
      },
      {
        key: 'cache-key-alpha',
        label: 'Alpha v1.wav',
        priority: ANALYSIS_PRIORITY_BACKGROUND,
      }
    );

    await flushMicrotasks();

    const user = queue.enqueue(
      async () => {
        await userGate.promise;
      },
      {
        key: 'cache-key-bravo',
        label: 'Bravo v2.wav',
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
      }
    );

    await flushMicrotasks();

    expect(queue.dump().runningJobs).toEqual([
      {
        key: 'cache-key-alpha',
        priority: ANALYSIS_PRIORITY_BACKGROUND,
        label: 'Alpha v1.wav',
        slot: 'regular',
      },
      {
        key: 'cache-key-bravo',
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        label: 'Bravo v2.wav',
        slot: 'user-bypass',
      },
    ]);

    userGate.resolve();
    backgroundGate.resolve();
    await Promise.all([background, user]);
    expect(queue.dump().runningJobs).toEqual([]);
  });

  // --- v3.120 (Item #14 follow-up) — task timeout tests ---

  it('rejects a stuck task after taskTimeoutMs and frees the slot', async () => {
    // Simulates the "stuck forever" mode: a task that never resolves or
    // rejects (decodeAudioData hang, ffmpeg deadlock). The queue must NOT
    // wait forever — after taskTimeoutMs it rejects the caller and frees
    // the slot so the next task can run.
    vi.useFakeTimers();
    try {
      const queue = new AnalysisQueue({
        concurrency: 1,
        label: 'test-timeout',
        taskTimeoutMs: 1000,
        // v3.207 — explicitly opt out of cold-start grace so this regression
        // test continues to assert the steady-state 1000ms timeout. Cold-
        // start grace has its own dedicated coverage below.
        coldStartTimeoutMs: 0,
      });

      let stuckSettled = false;
      const stuckPromise = queue.enqueue(
        () =>
          new Promise<void>(() => {
            // Never settles. If the queue waited on this, the test would hang.
          })
      );
      stuckPromise.catch(() => {
        stuckSettled = true;
      });

      // After 999ms still pending.
      await vi.advanceTimersByTimeAsync(999);
      expect(stuckSettled).toBe(false);

      // At taskTimeoutMs the queue rejects.
      await vi.advanceTimersByTimeAsync(1);
      await expect(stuckPromise).rejects.toBeInstanceOf(AnalysisTaskTimeoutError);

      // Slot is freed — a new task runs immediately.
      let nextRan = false;
      const nextPromise = queue.enqueue(async () => {
        nextRan = true;
        return 'ok';
      });
      await vi.advanceTimersByTimeAsync(0);
      // Drain microtasks so the next task can run.
      await Promise.resolve();
      await Promise.resolve();
      await expect(nextPromise).resolves.toBe('ok');
      expect(nextRan).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT reject a task that resolves before the timeout', async () => {
    vi.useFakeTimers();
    try {
      const queue = new AnalysisQueue({
        concurrency: 1,
        taskTimeoutMs: 1000,
        coldStartTimeoutMs: 0,
      });

      let settledValue: string | null = null;
      const promise = queue.enqueue(async () => 'fast');
      promise.then((v) => {
        settledValue = v;
      });

      // Resolve before timeout fires.
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await expect(promise).resolves.toBe('fast');
      expect(settledValue).toBe('fast');

      // Advancing past the timeout must not throw or double-settle.
      await vi.advanceTimersByTimeAsync(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves task error path for tasks that reject before timeout', async () => {
    vi.useFakeTimers();
    try {
      const queue = new AnalysisQueue({
        concurrency: 1,
        taskTimeoutMs: 1000,
        coldStartTimeoutMs: 0,
      });

      const promise = queue.enqueue(async () => {
        throw new Error('underlying failure');
      });
      // Attach a .catch synchronously so the rejection isn't reported as
      // an unhandled rejection before the awaiting expect runs.
      promise.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await expect(promise).rejects.toThrow('underlying failure');

      // Make sure the timeout path doesn't fire afterwards and emit a
      // second rejection for the same task.
      await vi.advanceTimersByTimeAsync(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables the timer when taskTimeoutMs is 0', async () => {
    // Tests in this file assume no timeout unless explicitly configured;
    // this regression test pins that behavior.
    vi.useFakeTimers();
    try {
      const queue = new AnalysisQueue({
        concurrency: 1,
        taskTimeoutMs: 0,
      });

      const blocker = deferred<string>();
      const slowPromise = queue.enqueue(async () => {
        return blocker.promise;
      });

      // Advance way past any reasonable timeout. With taskTimeoutMs=0 the
      // queue must NOT reject.
      await vi.advanceTimersByTimeAsync(120_000);
      blocker.resolve('eventually');
      await expect(slowPromise).resolves.toBe('eventually');
    } finally {
      vi.useRealTimers();
    }
  });

  // --- v3.207 — cold-start grace timeout (post-reboot / post-auto-update race) ---

  describe('coldStartTimeoutMs', () => {
    it('uses cold-start grace until the FIRST task resolves successfully, then reverts to normal timeout', async () => {
      // The bug Ethan hit (voice 2957, 2026-05-14): after restarting his Mac,
      // Producer Player launched the freshly-installed v3.206 binary. The
      // first 6 USER_SELECTED analyses (1 preview + 2 measured-concurrency
      // waves of 3) all timed out at exactly +60s while macOS was still
      // verifying the bundled ffmpeg signature + warming dyld caches. A
      // manual double-click a few seconds later worked instantly because
      // everything was warm by then. This test pins the fix: cold-start
      // tasks get an extended grace window, but once any task succeeds the
      // queue switches to the normal (tighter) timeout.
      vi.useFakeTimers();
      try {
        const queue = new AnalysisQueue({
          concurrency: 1,
          label: 'test-cold-start',
          taskTimeoutMs: 1000,
          coldStartTimeoutMs: 5000,
        });

        expect(queue.isWarm()).toBe(false);
        expect(queue.getEffectiveTimeoutMs()).toBe(5000);

        // First task takes 2500ms — would time out under the normal 1000ms
        // budget, but cold-start grace gives it 5000ms.
        const firstPromise = queue.enqueue(
          () => new Promise<string>((resolve) => setTimeout(() => resolve('cold-ok'), 2500))
        );
        await vi.advanceTimersByTimeAsync(2500);
        await expect(firstPromise).resolves.toBe('cold-ok');

        // First success flips the queue to warm.
        expect(queue.isWarm()).toBe(true);
        expect(queue.getEffectiveTimeoutMs()).toBe(1000);

        // Subsequent stuck task gets rejected at the normal 1000ms timeout,
        // not the 5000ms grace window.
        const stuckPromise = queue.enqueue(() => new Promise<string>(() => {}));
        stuckPromise.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(999);
        // Not yet rejected.
        let stuckRejected = false;
        stuckPromise.catch(() => {
          stuckRejected = true;
        });
        expect(stuckRejected).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(stuckPromise).rejects.toBeInstanceOf(AnalysisTaskTimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still times out a cold-start task that exceeds the grace window', async () => {
      // Cold-start grace MUST NOT be infinite — a genuinely stuck task
      // (decodeAudioData hang, ffmpeg deadlock) needs to be caught even on
      // cold start, just with a wider budget. After coldStartTimeoutMs the
      // task is rejected with AnalysisTaskTimeoutError and the queue stays
      // un-warmed (failure does NOT mark first-success).
      vi.useFakeTimers();
      try {
        const queue = new AnalysisQueue({
          concurrency: 1,
          taskTimeoutMs: 1000,
          coldStartTimeoutMs: 5000,
        });

        const stuckPromise = queue.enqueue(() => new Promise<string>(() => {}));
        stuckPromise.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(4999);
        expect(queue.isWarm()).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(stuckPromise).rejects.toBeInstanceOf(AnalysisTaskTimeoutError);

        // Failure does NOT warm the queue.
        expect(queue.isWarm()).toBe(false);
        expect(queue.getEffectiveTimeoutMs()).toBe(5000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejections and preemptions do NOT mark the queue warm', async () => {
      // Only a real resolve proves the runtime is healthy. A task that
      // rejects (e.g. ffmpeg exits non-zero on a corrupt file) tells us
      // nothing about whether the binary is responsive; if the NEXT task
      // is a slow first-decode of a valid file, it still deserves the
      // cold-start grace window.
      vi.useFakeTimers();
      try {
        const queue = new AnalysisQueue({
          concurrency: 1,
          taskTimeoutMs: 1000,
          coldStartTimeoutMs: 5000,
        });

        const failed = queue.enqueue(async () => {
          throw new Error('bad file');
        });
        failed.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        await Promise.resolve();
        await expect(failed).rejects.toThrow('bad file');

        // Queue is still in cold-start mode after a failure.
        expect(queue.isWarm()).toBe(false);
        expect(queue.getEffectiveTimeoutMs()).toBe(5000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('late natural resolve after cold-start timeout does NOT mark the queue warm', async () => {
      // v3.208 — Codex review regression pin. Earlier `firstSuccessSettled =
      // true` was set unconditionally in the success handler, so a task that
      // (a) ran during cold-start grace, (b) timed out at coldStartTimeoutMs,
      // (c) THEN naturally resolved a moment later in the background would
      // incorrectly flip the queue to warm. The caller saw an
      // AnalysisTaskTimeoutError; the runtime health proof was NOT observable
      // to them, so the queue must stay cold-started for the next task.
      vi.useFakeTimers();
      try {
        const queue = new AnalysisQueue({
          concurrency: 1,
          taskTimeoutMs: 1000,
          coldStartTimeoutMs: 5000,
        });

        // Task runs for 6000ms — exceeds the 5000ms cold-start grace window.
        const latePromise = queue.enqueue(
          () => new Promise<string>((resolve) => setTimeout(() => resolve('late-ok'), 6000))
        );
        latePromise.catch(() => undefined);

        // Advance past the 5000ms grace timeout — caller is rejected.
        await vi.advanceTimersByTimeAsync(5000);
        await expect(latePromise).rejects.toBeInstanceOf(AnalysisTaskTimeoutError);

        // Drain the remaining 1000ms — the underlying task resolves naturally.
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
        await Promise.resolve();

        // Queue MUST still report cold-started even though the late resolve
        // landed. The caller saw a timeout; the next task deserves the full
        // grace window.
        expect(queue.isWarm()).toBe(false);
        expect(queue.getEffectiveTimeoutMs()).toBe(5000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('defaults coldStartTimeoutMs to 3× taskTimeoutMs when omitted', async () => {
      const queue = new AnalysisQueue({ concurrency: 1, taskTimeoutMs: 1000 });
      // Pre-warm: 3000ms grace window.
      expect(queue.getEffectiveTimeoutMs()).toBe(3000);
    });

    it('disables cold-start grace when taskTimeoutMs is 0', async () => {
      // A queue with no timeout at all has nothing to extend; cold-start
      // grace must NOT introduce a timeout where none was configured.
      const queue = new AnalysisQueue({ concurrency: 1, taskTimeoutMs: 0 });
      expect(queue.getEffectiveTimeoutMs()).toBe(0);
    });

    it('disables cold-start grace when coldStartTimeoutMs is 0', async () => {
      // Explicit opt-out: caller wants the normal timeout to apply even on
      // cold start (e.g. test code that wants deterministic timings).
      const queue = new AnalysisQueue({
        concurrency: 1,
        taskTimeoutMs: 1000,
        coldStartTimeoutMs: 0,
      });
      expect(queue.getEffectiveTimeoutMs()).toBe(1000);
    });
  });

  // --- v3.190 — rapid-switch demotion tests ---

  describe('demote()', () => {
    it('demotes a pending user-priority task so a newer click wins the bypass slot', async () => {
      // Scenario: user clicks track A (gets bypass), then clicks track B before
      // A's analysis even starts (still pending). B should preempt A. Without
      // demote, both A and B sit at USER_SELECTED priority and the cap may
      // fill with stale A clicks, starving the user's actual intent.
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 1, // forces competition for the bypass slot
      });
      const order: string[] = [];

      const bg = deferred<void>();
      // Bg task holds the regular slot.
      queue.enqueue(async () => {
        order.push('bg:start');
        await bg.promise;
        order.push('bg:end');
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

      await flushMicrotasks();

      const aGate = deferred<void>();
      const aPromise = queue.enqueue(async () => {
        order.push('A:start');
        await aGate.promise;
        order.push('A:end');
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'A' });

      await flushMicrotasks();
      // A bypassed the cap; it's now running.
      expect(order).toContain('A:start');
      expect(queue.stats().userBypassActive).toBe(1);

      // User changes mind: clicks B. Demote A first so the bypass slot opens
      // for B. With maxUserBypassSlots=1, B would otherwise be pending.
      queue.demote('A', ANALYSIS_PRIORITY_NEIGHBOR);
      const bPromise = queue.enqueue(async () => {
        order.push('B');
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'B' });

      await flushMicrotasks();
      // B should now bypass since A no longer holds the bypass slot.
      expect(order).toContain('B');
      // B settled; bypass slot freed back; A is still running (demoted to
      // regular slot equivalent).
      expect(queue.stats().userBypassActive).toBe(0);

      aGate.resolve();
      bg.resolve();
      await Promise.all([aPromise, bPromise]);
    });

    it('reorders pending tasks by priority after demote', async () => {
      // A pending USER task can be demoted to NEIGHBOR, then a fresh USER
      // enqueue should run before it.
      const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 0 });
      const order: string[] = [];
      const blocker = deferred<void>();

      queue.enqueue(async () => {
        await blocker.promise;
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

      queue.enqueue(async () => {
        order.push('A');
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'A' });
      queue.enqueue(async () => {
        order.push('B');
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'B' });

      // Now demote A. B is still USER, so B should run BEFORE A.
      queue.demote('A', ANALYSIS_PRIORITY_NEIGHBOR);

      blocker.resolve();
      while (queue.stats().active > 0 || queue.stats().pending > 0) {
        // eslint-disable-next-line no-await-in-loop
        await flushMicrotasks();
      }
      expect(order).toEqual(['B', 'A']);
    });

    it('does NOT promote — passing a LOWER priority value is a no-op', async () => {
      // demote is strictly "make this less urgent". Passing USER (0) to a
      // NEIGHBOR (1) task would be a promote, which is the wrong API; the
      // method should refuse and leave the task at NEIGHBOR.
      const queue = new AnalysisQueue({ concurrency: 1, maxUserBypassSlots: 0 });
      const order: string[] = [];
      const blocker = deferred<void>();

      queue.enqueue(async () => {
        await blocker.promise;
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

      queue.enqueue(async () => {
        order.push('A');
      }, { priority: ANALYSIS_PRIORITY_NEIGHBOR, key: 'A' });
      queue.enqueue(async () => {
        order.push('B');
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND, key: 'B' });

      // Attempt to "demote" A to USER (would be a promote — no-op).
      const changed = queue.demote('A', ANALYSIS_PRIORITY_USER_SELECTED);
      expect(changed).toBe(false);

      blocker.resolve();
      while (queue.stats().active > 0 || queue.stats().pending > 0) {
        // eslint-disable-next-line no-await-in-loop
        await flushMicrotasks();
      }
      // Order should still reflect A=NEIGHBOR, B=BACKGROUND.
      expect(order).toEqual(['A', 'B']);
    });

    it('is a no-op for unknown keys', () => {
      const queue = new AnalysisQueue({ concurrency: 1 });
      const result = queue.demote('does-not-exist', ANALYSIS_PRIORITY_NEIGHBOR);
      expect(result).toBe(false);
    });

    it('updates bookkeeping when a running user-bypass task is demoted', async () => {
      // Regression: after demote, the bypass slot accounting must release so
      // a future click can bypass. Otherwise rapid-switch leaks bypass slots.
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 1,
      });

      const bg = deferred<void>();
      const bgPromise = queue.enqueue(async () => {
        await bg.promise;
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

      await flushMicrotasks();

      const aGate = deferred<void>();
      const aPromise = queue.enqueue(async () => {
        await aGate.promise;
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'A' });

      await flushMicrotasks();
      expect(queue.stats().userBypassActive).toBe(1);

      // Demote: bypass slot must free so a new click bypasses.
      queue.demote('A', ANALYSIS_PRIORITY_NEIGHBOR);
      expect(queue.stats().userBypassActive).toBe(0);

      const bGate = deferred<void>();
      const bPromise = queue.enqueue(async () => {
        await bGate.promise;
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'B' });

      await flushMicrotasks();
      expect(queue.stats().userBypassActive).toBe(1);

      // Drain.
      aGate.resolve();
      bGate.resolve();
      bg.resolve();
      await Promise.all([aPromise, bPromise, bgPromise]);
      expect(queue.stats().userBypassActive).toBe(0);
      expect(queue.stats().active).toBe(0);
    });

    it('preserves the dedup key — a re-enqueue at the new priority resolves with the in-flight result', async () => {
      // After demote, the running task is still associated with its key.
      // A fresh enqueue at USER priority for the SAME key should dedupe to
      // the running task — only one task runs and both callers see the same
      // result.
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 1,
      });

      const bg = deferred<void>();
      queue.enqueue(async () => {
        await bg.promise;
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

      await flushMicrotasks();

      const aGate = deferred<string>();
      const runner = vi.fn(async () => aGate.promise);
      const a1 = queue.enqueue(runner, {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        key: 'A',
      });
      await flushMicrotasks();

      // Demote A.
      queue.demote('A', ANALYSIS_PRIORITY_NEIGHBOR);
      // Re-enqueue at USER (e.g. user clicks back to A). Should NOT spawn a
      // second task; both callers see the same eventual result.
      const a2 = queue.enqueue(async () => 'should-not-run', {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        key: 'A',
      });

      aGate.resolve('done');
      bg.resolve();
      await expect(a1).resolves.toBe('done');
      await expect(a2).resolves.toBe('done');
      // The runner only ran once — the second enqueue deduped to the
      // existing inflight task instead of starting a new one.
      expect(runner).toHaveBeenCalledTimes(1);
    });

    it('updates dump() activeByPriority counts after demote', async () => {
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 1,
      });

      const bg = deferred<void>();
      queue.enqueue(async () => {
        await bg.promise;
      }, { priority: ANALYSIS_PRIORITY_BACKGROUND });

      await flushMicrotasks();

      const aGate = deferred<void>();
      const aPromise = queue.enqueue(async () => {
        await aGate.promise;
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'A' });

      await flushMicrotasks();
      expect(queue.dump().activeByPriority).toEqual({ user: 1, neighbor: 0, background: 1 });

      queue.demote('A', ANALYSIS_PRIORITY_NEIGHBOR);
      expect(queue.dump().activeByPriority).toEqual({ user: 0, neighbor: 1, background: 1 });

      aGate.resolve();
      bg.resolve();
      await aPromise;
      expect(queue.dump().activeByPriority).toEqual({ user: 0, neighbor: 0, background: 0 });
    });

    it('lets a newer USER click interrupt a previously-running USER task after demotion', async () => {
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 0,
      });

      let aRuns = 0;
      let aAborted = false;
      const aPromise = queue.enqueue(async (signal) => {
        aRuns += 1;
        if (aRuns === 1) {
          return new Promise<string>((_, reject) => {
            signal.addEventListener('abort', () => {
              aAborted = true;
              reject(new Error('A aborted'));
            });
          });
        }
        return 'A retry complete';
      }, {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        key: 'A',
        cancellable: true,
      });

      await flushMicrotasks();
      expect(aRuns).toBe(1);

      queue.demote('A', ANALYSIS_PRIORITY_NEIGHBOR);
      let bRan = false;
      const bPromise = queue.enqueue(async () => {
        bRan = true;
        return 'B complete';
      }, {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        key: 'B',
      });

      await flushMicrotasks();
      expect(aAborted).toBe(true);
      expect(bRan).toBe(true);
      await expect(bPromise).resolves.toBe('B complete');
      await expect(aPromise).resolves.toBe('A retry complete');
    });
  });

  it('frees a bypass slot when a user-priority task times out', async () => {
    // Regression: the bypass-slot accounting must also be cleaned up by
    // the timeout path. Otherwise userBypassActive could leak past the
    // cap and starve subsequent user clicks.
    vi.useFakeTimers();
    try {
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 1,
        taskTimeoutMs: 500,
        // v3.207 — opt out of cold-start grace so the 500ms steady-state
        // timeout fires on the first task as the test expects.
        coldStartTimeoutMs: 0,
      });

      // BG task holds the regular slot — perpetual. Attach a .catch so
      // its eventual timeout rejection is handled (we don't care about
      // the bg task's resolution; only that it occupies the slot long
      // enough for the user-priority bypass case below).
      const bgPromise = queue.enqueue(
        () => new Promise<void>(() => {}),
        { priority: ANALYSIS_PRIORITY_BACKGROUND }
      );
      bgPromise.catch(() => undefined);
      await Promise.resolve();
      expect(queue.stats().userBypassActive).toBe(0);

      // User-priority task takes the bypass slot — also perpetual.
      const stuck = queue.enqueue(
        () => new Promise<void>(() => {}),
        { priority: ANALYSIS_PRIORITY_USER_SELECTED }
      );
      stuck.catch(() => {});
      await Promise.resolve();
      expect(queue.stats().userBypassActive).toBe(1);

      // Trigger timeout for the stuck user task.
      await vi.advanceTimersByTimeAsync(500);
      await expect(stuck).rejects.toBeInstanceOf(AnalysisTaskTimeoutError);
      expect(queue.stats().userBypassActive).toBe(0);

      // Another user-priority click must now bypass successfully (cap
      // wasn't permanently consumed).
      let secondRan = false;
      const second = queue.enqueue(
        async () => {
          secondRan = true;
        },
        { priority: ANALYSIS_PRIORITY_USER_SELECTED }
      );
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await expect(second).resolves.toBeUndefined();
      expect(secondRan).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // --- v3.195 — USER-priority preemption (cancel + requeue) tests ---

  describe('USER preemption', () => {
    it('aborts every running cancellable lower-priority task and starts USER immediately', async () => {
      // Scenario: cold-launch warmup. Two NEIGHBOR ffmpeg jobs are running in
      // both regular slots. User clicks a song. The queue should synchronously
      // abort both lower-priority jobs and start USER without waiting for their
      // AbortError promises to unwind.
      const queue = new AnalysisQueue({
        concurrency: 2,
        maxUserBypassSlots: 0, // force preemption — no bypass available
      });

      const neighborSignals: AbortSignal[] = [];
      const neighborTaskFn = (id: string) => async (signal: AbortSignal) => {
        neighborSignals.push(signal);
        return new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error(`${id} aborted`));
          });
        });
      };

      const n1 = queue.enqueue(neighborTaskFn('n1'), {
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        key: 'n1',
        cancellable: true,
      });
      n1.catch(() => undefined);
      const n2 = queue.enqueue(neighborTaskFn('n2'), {
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        key: 'n2',
        cancellable: true,
      });
      n2.catch(() => undefined);

      await flushMicrotasks();
      expect(queue.stats().active).toBe(2);
      expect(neighborSignals.length).toBe(2);
      expect(neighborSignals[0].aborted).toBe(false);
      expect(neighborSignals[1].aborted).toBe(false);

      // User clicks — should preempt both NEIGHBOR tasks.
      let userRan = false;
      const userPromise = queue.enqueue(async () => {
        userRan = true;
        return 'user-done';
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'user' });

      await flushMicrotasks();
      // Both neighbors should be aborted; USER should not wait for their
      // rejection handlers before running.
      const abortedCount = neighborSignals.filter((s) => s.aborted).length;
      expect(abortedCount).toBe(2);
      await expect(userPromise).resolves.toBe('user-done');
      expect(userRan).toBe(true);
    });

    it('does not wait for an aborted lower-priority task to reject before running USER', async () => {
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 0,
      });

      let backgroundAborted = false;
      const backgroundPromise = queue.enqueue(async (signal) => {
        signal.addEventListener('abort', () => {
          backgroundAborted = true;
        });
        // Simulates a decode/IPC path whose abort rejection is delayed or
        // never arrives. The queue must still free the slot synchronously.
        return new Promise<string>(() => undefined);
      }, {
        priority: ANALYSIS_PRIORITY_BACKGROUND,
        key: 'background-stuck-after-abort',
        cancellable: true,
      });
      backgroundPromise.catch(() => undefined);

      await flushMicrotasks();
      expect(queue.stats().active).toBe(1);

      let userRan = false;
      const userPromise = queue.enqueue(async () => {
        userRan = true;
        return 'user-now';
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'user-now' });

      await flushMicrotasks();
      expect(backgroundAborted).toBe(true);
      expect(userRan).toBe(true);
      await expect(userPromise).resolves.toBe('user-now');
    });

    it('reserves a USER slot immediately even when the task body is delayed', async () => {
      // v3.263 regression pin: Producer Player delays heavy selected-track
      // ffmpeg/WebAudio bodies briefly so playback startup stays smooth. The
      // delay must happen AFTER queue admission, not before enqueue, otherwise
      // lower-priority warmup keeps occupying the queue while the selected
      // track sits in a visible Loading state.
      vi.useFakeTimers();
      try {
        const queue = new AnalysisQueue({
          concurrency: 1,
          maxUserBypassSlots: 0,
          taskTimeoutMs: 0,
        });

        let backgroundRuns = 0;
        let backgroundAborted = false;
        const backgroundPromise = queue.enqueue(
          async (signal): Promise<string> => {
            backgroundRuns += 1;
            if (backgroundRuns === 1) {
              return new Promise<string>((_, reject) => {
                signal.addEventListener('abort', () => {
                  backgroundAborted = true;
                  reject(new Error('background aborted'));
                });
              });
            }
            return 'background-final';
          },
          {
            priority: ANALYSIS_PRIORITY_NEIGHBOR,
            key: 'warmup-track',
            cancellable: true,
          }
        );

        await flushMicrotasks();
        expect(backgroundRuns).toBe(1);
        expect(queue.dump().activeByPriority.neighbor).toBe(1);

        let userRuns = 0;
        const userPromise = queue.enqueue(
          async () => {
            userRuns += 1;
            return 'selected-ready';
          },
          {
            priority: ANALYSIS_PRIORITY_USER_SELECTED,
            key: 'selected-track',
            cancellable: true,
            startDelayMs: 1000,
          }
        );

        await flushMicrotasks();
        expect(backgroundAborted).toBe(true);
        expect(queue.dump().activeByPriority.user).toBe(1);
        expect(userRuns).toBe(0);

        await vi.advanceTimersByTimeAsync(999);
        await flushMicrotasks();
        expect(userRuns).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        await expect(userPromise).resolves.toBe('selected-ready');
        expect(userRuns).toBe(1);

        await flushMicrotasks();
        await expect(backgroundPromise).resolves.toBe('background-final');
        expect(backgroundRuns).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('restarts an already-running warmup duplicate when the selected track claims it', async () => {
      // v3.265 regression pin: a selected track can attach to the same cache
      // key that startup warmup is already analysing. Returning that aging
      // warmup promise in-place preserved its old timeout deadline, so the UI
      // could show "Measured analysis timed out" almost immediately after the
      // user selected the track. The duplicate USER enqueue must abort/requeue
      // the lower-priority run and give the shared promise a fresh USER window.
      vi.useFakeTimers();
      try {
        const queue = new AnalysisQueue({
          concurrency: 1,
          maxUserBypassSlots: 0,
          taskTimeoutMs: 1000,
          coldStartTimeoutMs: 1000,
        });

        let runs = 0;
        let aborts = 0;
        const warmupPromise = queue.enqueue(
          async (signal): Promise<string> => {
            runs += 1;
            const runNumber = runs;
            return new Promise<string>((resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  aborts += 1;
                  reject(new Error(`run ${runNumber} aborted`));
                },
                { once: true }
              );
              if (runNumber === 2) {
                setTimeout(() => resolve('selected-ready'), 100);
              }
            });
          },
          {
            priority: ANALYSIS_PRIORITY_NEIGHBOR,
            key: 'same-track-cache-key',
            cancellable: true,
          }
        );

        await flushMicrotasks();
        expect(runs).toBe(1);
        expect(queue.dump().activeByPriority.neighbor).toBe(1);

        await vi.advanceTimersByTimeAsync(900);
        await flushMicrotasks();

        const selectedPromise = queue.enqueue(
          async () => 'should-not-create-a-second-task-body',
          {
            priority: ANALYSIS_PRIORITY_USER_SELECTED,
            key: 'same-track-cache-key',
            cancellable: true,
            startDelayMs: 200,
          }
        );

        await flushMicrotasks();
        expect(selectedPromise).toBe(warmupPromise);
        expect(aborts).toBe(1);
        expect(queue.dump().activeByPriority.user).toBe(1);
        expect(runs).toBe(1);

        await vi.advanceTimersByTimeAsync(199);
        await flushMicrotasks();
        expect(runs).toBe(1);

        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(runs).toBe(2);

        await vi.advanceTimersByTimeAsync(100);
        await expect(selectedPromise).resolves.toBe('selected-ready');
        await expect(warmupPromise).resolves.toBe('selected-ready');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the selected-track delay when App.tsx promotes before duplicate enqueue', async () => {
      // v3.266 review pin: production selection does two things in order for
      // an already-warmup-enqueued track: promote(cacheKey, USER), then
      // runMeasuredAnalysis(...same cacheKey, startDelayMs). The duplicate
      // enqueue must patch that delay onto the just-restarted USER task before
      // its microtask starts; otherwise the heavy analysis body can run
      // immediately and steal CPU from playback startup.
      vi.useFakeTimers();
      try {
        const queue = new AnalysisQueue({
          concurrency: 1,
          maxUserBypassSlots: 0,
          taskTimeoutMs: 0,
        });

        let runs = 0;
        let aborts = 0;
        const warmupPromise = queue.enqueue(
          async (signal): Promise<string> => {
            runs += 1;
            const runNumber = runs;
            return new Promise<string>((resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  aborts += 1;
                  reject(new Error(`run ${runNumber} aborted`));
                },
                { once: true }
              );
              if (runNumber === 2) {
                setTimeout(() => resolve('selected-after-delay'), 10);
              }
            });
          },
          {
            priority: ANALYSIS_PRIORITY_NEIGHBOR,
            key: 'promote-then-enqueue-cache-key',
            cancellable: true,
          }
        );

        await flushMicrotasks();
        expect(runs).toBe(1);
        expect(queue.dump().activeByPriority.neighbor).toBe(1);

        queue.promote('promote-then-enqueue-cache-key', ANALYSIS_PRIORITY_USER_SELECTED);
        const selectedPromise = queue.enqueue(
          async () => 'duplicate-body-should-not-run',
          {
            priority: ANALYSIS_PRIORITY_USER_SELECTED,
            key: 'promote-then-enqueue-cache-key',
            cancellable: true,
            startDelayMs: 250,
          }
        );

        await flushMicrotasks();
        expect(aborts).toBe(1);
        expect(queue.dump().activeByPriority.user).toBe(1);
        expect(runs).toBe(1);

        await vi.advanceTimersByTimeAsync(249);
        await flushMicrotasks();
        expect(runs).toBe(1);

        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(runs).toBe(2);

        await vi.advanceTimersByTimeAsync(10);
        await expect(selectedPromise).resolves.toBe('selected-after-delay');
        await expect(warmupPromise).resolves.toBe('selected-after-delay');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not restart lower-priority retries while a USER task is still running', async () => {
      const queue = new AnalysisQueue({
        concurrency: 2,
        maxUserBypassSlots: 0,
      });

      const makeBackgroundTask = (id: string) => async (signal: AbortSignal) => {
        return new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error(`${id} aborted`)));
        });
      };

      const bg1 = queue.enqueue(makeBackgroundTask('bg1'), {
        priority: ANALYSIS_PRIORITY_BACKGROUND,
        key: 'bg1',
        cancellable: true,
      });
      bg1.catch(() => undefined);
      const bg2 = queue.enqueue(makeBackgroundTask('bg2'), {
        priority: ANALYSIS_PRIORITY_BACKGROUND,
        key: 'bg2',
        cancellable: true,
      });
      bg2.catch(() => undefined);

      await flushMicrotasks();

      const userGate = deferred<string>();
      const userPromise = queue.enqueue(async () => userGate.promise, {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        key: 'user-gated',
      });

      await flushMicrotasks();

      const dumpWhileUserRuns = queue.dump();
      expect(dumpWhileUserRuns.activeByPriority).toEqual({
        user: 1,
        neighbor: 0,
        background: 0,
      });
      expect(dumpWhileUserRuns.runningJobs).toEqual([
        {
          key: 'user-gated',
          priority: ANALYSIS_PRIORITY_USER_SELECTED,
          label: null,
          slot: 'regular',
        },
      ]);
      expect(dumpWhileUserRuns.pendingByPriority.background).toBe(2);

      userGate.resolve('user-complete');
      await expect(userPromise).resolves.toBe('user-complete');
    });

    it('requeues a preempted task at its original priority so it runs after USER completes', async () => {
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 0,
      });

      let neighborCallCount = 0;
      const neighborTask = async (signal: AbortSignal): Promise<string> => {
        neighborCallCount += 1;
        const thisRun = neighborCallCount;
        if (thisRun === 1) {
          // First run is preempted.
          return new Promise<string>((_, reject) => {
            signal.addEventListener('abort', () => {
              reject(new Error('n1 aborted'));
            });
          });
        }
        // Second run completes normally.
        return 'n1-done-second';
      };

      const nPromise = queue.enqueue(neighborTask, {
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        key: 'n1',
        cancellable: true,
      });

      await flushMicrotasks();
      expect(neighborCallCount).toBe(1);

      // User preempts.
      const userGate = deferred<void>();
      const userPromise = queue.enqueue(async () => {
        await userGate.promise;
      }, { priority: ANALYSIS_PRIORITY_USER_SELECTED });

      // Drain the abort rejection so the slot frees + user runs.
      await flushMicrotasks();
      await flushMicrotasks();

      // User task should now be running.
      expect(queue.stats().active).toBe(1);

      userGate.resolve();
      await userPromise;
      await flushMicrotasks();
      await flushMicrotasks();

      // After user finishes, the requeued neighbor should run AGAIN.
      expect(neighborCallCount).toBe(2);
      await expect(nPromise).resolves.toBe('n1-done-second');
    });

    it('does NOT abort non-cancellable running tasks; uses bypass instead', async () => {
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 1,
      });

      let neighborAborted = false;
      const neighborGate = deferred<void>();
      const neighborPromise = queue.enqueue(async (signal) => {
        signal.addEventListener('abort', () => {
          neighborAborted = true;
        });
        await neighborGate.promise;
        return 'neighbor-natural';
      }, {
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        key: 'n1',
        cancellable: false,
      });

      await flushMicrotasks();
      expect(queue.stats().active).toBe(1);

      const userPromise = queue.enqueue(async () => 'user', {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
        key: 'u1',
      });

      await flushMicrotasks();
      // Neighbor was NOT aborted (cancellable=false).
      expect(neighborAborted).toBe(false);
      // User ran via bypass instead.
      await expect(userPromise).resolves.toBe('user');

      // Let neighbor finish naturally.
      neighborGate.resolve();
      await expect(neighborPromise).resolves.toBe('neighbor-natural');
    });

    it('caller of a cancellable task does NOT see the preemption — only the eventual result', async () => {
      // The whole point of requeue: the caller's promise stays pending until
      // the task finally settles for real, even across an abort+restart.
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 0,
      });

      let attempt = 0;
      const task = async (signal: AbortSignal): Promise<string> => {
        attempt += 1;
        if (attempt === 1) {
          return new Promise<string>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return 'final-value';
      };

      const promise = queue.enqueue(task, {
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        key: 'n1',
        cancellable: true,
      });

      await flushMicrotasks();
      // Preempt with user.
      const userPromise = queue.enqueue(async () => 'user', {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
      });

      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();

      // The neighbor's caller-facing promise should still be PENDING — the
      // requeue is transparent.
      await expect(userPromise).resolves.toBe('user');
      await expect(promise).resolves.toBe('final-value');
      expect(attempt).toBe(2);
    });

    it('preempts all lower-priority work when USER is pending', async () => {
      const queue = new AnalysisQueue({
        concurrency: 3,
        maxUserBypassSlots: 0,
      });

      const signals: AbortSignal[] = [];
      const makeBgTask = () => async (signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      };

      // 3 background tasks fill all slots.
      const bgs = [1, 2, 3].map((i) => {
        const p = queue.enqueue(makeBgTask(), {
          priority: ANALYSIS_PRIORITY_BACKGROUND,
          key: `bg${i}`,
          cancellable: true,
        });
        p.catch(() => undefined);
        return p;
      });

      await flushMicrotasks();
      expect(signals.length).toBe(3);
      expect(signals.filter((s) => s.aborted).length).toBe(0);

      // ONE user click → interrupt every lower-priority task, not just one.
      const userPromise = queue.enqueue(async () => 'user', {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
      });
      await flushMicrotasks();
      expect(signals.filter((s) => s.aborted).length).toBe(3);

      await expect(userPromise).resolves.toBe('user');

      // Cleanup: abort remaining bg's so test exits.
      void bgs;
    });

    it('exposes AnalysisTaskPreemptedError as a typed export for callers that want to detect it', () => {
      const err = new AnalysisTaskPreemptedError('some-key');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('AnalysisTaskPreemptedError');
      expect(err.key).toBe('some-key');
      expect(err.message).toContain('some-key');
    });

    it('a cancellable task that ignores the abort signal and resolves anyway has its value passed through', async () => {
      // Defensive: a task may legitimately finish a hair after we tried to
      // abort it (e.g. the ffmpeg child already had results buffered when we
      // SIGKILLed). We don't requeue in that case; we just pass the value
      // through and free the slot.
      //
      // Note: when preempted=true, our `then(resolve)` path resolves the
      // caller's promise with the value. The USER pending was already going
      // to be served by the bypass + maybeStart loop, so the slot release
      // here is bonus.
      const queue = new AnalysisQueue({
        concurrency: 1,
        maxUserBypassSlots: 0,
      });

      const taskFn = async () => 'completed-before-abort-effect';

      const nPromise = queue.enqueue(taskFn, {
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        cancellable: true,
        key: 'n',
      });
      await flushMicrotasks();
      await expect(nPromise).resolves.toBe('completed-before-abort-effect');
    });

    it('interrupts both BACKGROUND and NEIGHBOR work for USER priority', async () => {
      const queue = new AnalysisQueue({
        concurrency: 2,
        maxUserBypassSlots: 0,
      });

      let bgAborted = false;
      let neighborAborted = false;

      queue.enqueue(async (signal) => {
        signal.addEventListener('abort', () => { bgAborted = true; });
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('abort')));
        });
      }, {
        priority: ANALYSIS_PRIORITY_BACKGROUND,
        key: 'bg',
        cancellable: true,
      }).catch(() => undefined);

      queue.enqueue(async (signal) => {
        signal.addEventListener('abort', () => { neighborAborted = true; });
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('abort')));
        });
      }, {
        priority: ANALYSIS_PRIORITY_NEIGHBOR,
        key: 'nb',
        cancellable: true,
      }).catch(() => undefined);

      await flushMicrotasks();

      // One user click. Both lower-priority jobs should be interrupted.
      const userPromise = queue.enqueue(async () => 'u', {
        priority: ANALYSIS_PRIORITY_USER_SELECTED,
      });

      await flushMicrotasks();
      expect(bgAborted).toBe(true);
      expect(neighborAborted).toBe(true);

      await expect(userPromise).resolves.toBe('u');
    });

    // --- v3.201 — Finding 5 (bypass-enabled preemption) tests ---
    //
    // The existing v3.195 preemption tests use `maxUserBypassSlots: 0` to
    // force preemption. Production uses `maxUserBypassSlots: 3` for the
    // measured-analysis queue, and the v3.201 audit found that preemption
    // + bypass-in-same-call defeats the CPU-freeing intent: USER starts in
    // a bypass slot, and the freed regular slot immediately refills with
    // another NEIGHBOR. These tests cover the production semantics.

    describe('Finding 5 — preemption with bypass enabled (production config)', () => {
      it('does NOT refill the freed regular slot with NEIGHBOR after preemption — USER takes the regular slot', async () => {
        const queue = new AnalysisQueue({
          concurrency: 2,
          maxUserBypassSlots: 3, // production config
        });

        const neighborSignals: AbortSignal[] = [];
        let neighborAcceptCount = 0;
        const neighborTask = (id: string) => async (signal: AbortSignal) => {
          neighborSignals.push(signal);
          neighborAcceptCount += 1;
          return new Promise<string>((resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new Error(`${id} aborted`));
            });
          });
        };

        // 2 NEIGHBOR jobs filling both regular slots. Plus 4 NEIGHBOR
        // jobs pending — so the bypass loop COULD trivially refill if it
        // were allowed to run after preemption.
        for (let i = 1; i <= 6; i += 1) {
          queue.enqueue(neighborTask(`n${i}`), {
            priority: ANALYSIS_PRIORITY_NEIGHBOR,
            key: `n${i}`,
            cancellable: true,
          }).catch(() => undefined);
        }

        await flushMicrotasks();
        // 2 regular slots are running, 4 NEIGHBOR pending
        expect(queue.stats().active).toBe(2);
        expect(queue.stats().pending).toBe(4);
        expect(neighborSignals.length).toBe(2);

        // USER click — should preempt one NEIGHBOR. Bypass is enabled
        // (3 slots) but the v3.201 fix must suppress it for THIS call.
        let userRan = false;
        const userPromise = queue.enqueue(async () => {
          userRan = true;
          return 'user-done';
        }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'u' });

        await flushMicrotasks();

        // Preemption MUST have fired — at least one neighbor aborted.
        expect(neighborSignals.filter((s) => s.aborted).length).toBeGreaterThanOrEqual(1);

        // CRITICAL: USER must NOT have started in a bypass slot in this
        // tick. Bypass count should remain 0; USER takes the freed
        // regular slot when the preempted neighbor's settle fires.
        expect(queue.stats().userBypassActive).toBe(0);

        // Drain settles.
        for (let i = 0; i < 6; i += 1) {
          await flushMicrotasks();
        }

        await expect(userPromise).resolves.toBe('user-done');
        expect(userRan).toBe(true);

        // After USER ran in its slot, bypass should still be 0 (USER
        // never used a bypass slot).
        expect(queue.stats().userBypassActive).toBe(0);
        // After the user finishes, both regular slots may fill with
        // requeued + pending neighbors. neighborAcceptCount > 2 confirms
        // the requeue path ran (the preempted neighbor came back).
        expect(neighborAcceptCount).toBeGreaterThanOrEqual(3);
      });

      it('still preempts when 3 NEIGHBOR jobs are in flight and bypass is also enabled', async () => {
        const queue = new AnalysisQueue({
          concurrency: 3,
          maxUserBypassSlots: 3,
        });

        const signals: AbortSignal[] = [];
        const neighborTask = (id: string) => async (signal: AbortSignal) => {
          signals.push(signal);
          return new Promise<string>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error(`${id} aborted`)));
          });
        };

        for (let i = 1; i <= 3; i += 1) {
          queue.enqueue(neighborTask(`n${i}`), {
            priority: ANALYSIS_PRIORITY_NEIGHBOR,
            key: `n${i}`,
            cancellable: true,
          }).catch(() => undefined);
        }

        await flushMicrotasks();
        expect(queue.stats().active).toBe(3);

        let userRan = false;
        const userPromise = queue.enqueue(async () => {
          userRan = true;
          return 'u';
        }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'u' });

        await flushMicrotasks();

        // At least one of the three neighbors got cancelled.
        expect(signals.filter((s) => s.aborted).length).toBeGreaterThanOrEqual(1);
        // USER did NOT start in bypass — preempt-in-this-call returned
        // before bypass loop.
        expect(queue.stats().userBypassActive).toBe(0);

        for (let i = 0; i < 6; i += 1) {
          await flushMicrotasks();
        }
        await expect(userPromise).resolves.toBe('u');
        expect(userRan).toBe(true);
      });

      it('falls through to bypass when NO cancellable task can be preempted (all running tasks non-cancellable)', async () => {
        // Regression: the Finding 2 fix should NOT break the existing
        // bypass-as-fallback path. If preempt finds nothing to cancel,
        // the bypass loop must still kick in for the pending USER click.
        const queue = new AnalysisQueue({
          concurrency: 2,
          maxUserBypassSlots: 1,
        });

        const neighborGate = deferred<void>();
        const neighborPromise = queue.enqueue(async () => {
          await neighborGate.promise;
          return 'neighbor-natural';
        }, {
          priority: ANALYSIS_PRIORITY_NEIGHBOR,
          key: 'n1',
          cancellable: false, // NOT cancellable
        });
        const neighbor2Gate = deferred<void>();
        const neighbor2Promise = queue.enqueue(async () => {
          await neighbor2Gate.promise;
          return 'n2-natural';
        }, {
          priority: ANALYSIS_PRIORITY_NEIGHBOR,
          key: 'n2',
          cancellable: false,
        });

        await flushMicrotasks();
        expect(queue.stats().active).toBe(2);

        // USER click: preempt finds nothing to cancel; bypass picks up.
        // Use a gate so the USER task doesn't finish before we snapshot
        // userBypassActive.
        const userGate = deferred<string>();
        const userPromise = queue.enqueue(async () => userGate.promise, {
          priority: ANALYSIS_PRIORITY_USER_SELECTED,
          key: 'u',
        });

        await flushMicrotasks();
        // Bypass MUST have started (preempt was a no-op against the
        // non-cancellable neighbors, so the bypass fallback fired).
        expect(queue.stats().userBypassActive).toBe(1);

        userGate.resolve('u');
        await expect(userPromise).resolves.toBe('u');

        // Cleanup
        neighborGate.resolve();
        neighbor2Gate.resolve();
        await expect(neighborPromise).resolves.toBe('neighbor-natural');
        await expect(neighbor2Promise).resolves.toBe('n2-natural');
      });
    });

    // --- v3.201 — Finding 4 (inflightByKey dedup across requeue) tests ---
    //
    // When a NEIGHBOR task is preempted + requeued, the inflightByKey map
    // must keep its entry alive so that a rapid second USER click for the
    // SAME key dedupes to the same caller promise. Otherwise the second
    // enqueue would create a new task that runs in parallel with the
    // requeued one.

    describe('Finding 4 — inflightByKey dedup across requeue', () => {
      it('a duplicate enqueue for a preempted-and-requeued key dedupes (does not spawn a parallel task)', async () => {
        // Scenario: NEIGHBOR task A is running. USER clicks DIFFERENT key
        // B, preempting A. A's body rejects → settle()/requeue runs → A
        // is re-pushed into pending at NEIGHBOR priority. During that
        // window a duplicate enqueue for key A MUST dedupe to the
        // already-pending A (the requeued one), not spawn a second
        // parallel A.
        const queue = new AnalysisQueue({
          concurrency: 1,
          maxUserBypassSlots: 0,
        });

        let aRuns = 0;
        const aTask = async (signal: AbortSignal): Promise<string> => {
          aRuns += 1;
          const myRun = aRuns;
          if (myRun === 1) {
            return new Promise<string>((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('a-aborted')));
            });
          }
          return `a-final-run-${myRun}`;
        };

        const aPromise = queue.enqueue(aTask, {
          priority: ANALYSIS_PRIORITY_NEIGHBOR,
          key: 'A',
          cancellable: true,
        });

        await flushMicrotasks();
        expect(aRuns).toBe(1);

        // USER click for DIFFERENT key B preempts A.
        const userGate = deferred<void>();
        const userPromise = queue.enqueue(async () => {
          await userGate.promise;
        }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'B' });

        // Allow the preempt to fire, A's body to reject, settle() to run,
        // and requeue to place A back in pending. (User is now in the
        // freed regular slot, gated on userGate.)
        for (let i = 0; i < 4; i += 1) {
          await flushMicrotasks();
        }

        // A should be requeued in pending (not running — user holds slot).
        expect(aRuns).toBe(1); // A has not started its second run yet
        const dumpDuringRequeue = queue.dump();
        const aPending = dumpDuringRequeue.pendingByPriority.neighbor;
        expect(aPending).toBeGreaterThanOrEqual(1);

        // Duplicate enqueue for key A during the requeue window. This is
        // the Finding 4 path — inflightByKey must still contain A so this
        // dedupes rather than creating a parallel pending task.
        const pendingBefore = queue.stats().pending;
        const aDup = queue.enqueue(aTask, {
          priority: ANALYSIS_PRIORITY_NEIGHBOR,
          key: 'A',
          cancellable: true,
        });
        const pendingAfter = queue.stats().pending;

        // Pending count must NOT grow — dedupe wins.
        expect(pendingAfter).toBe(pendingBefore);

        // Now unblock user, then A should run exactly ONE more time
        // (run #2) and complete.
        userGate.resolve();
        await userPromise;
        for (let i = 0; i < 8; i += 1) {
          await flushMicrotasks();
        }

        await expect(aPromise).resolves.toBe('a-final-run-2');
        await expect(aDup).resolves.toBe('a-final-run-2');
        // run 1 = preempted, run 2 = final. NOT 3 — dedupe held across
        // the requeue window.
        expect(aRuns).toBe(2);
      });

      it('a USER-priority duplicate enqueue for a preempted-and-requeued NEIGHBOR key promotes + dedupes (only one final run)', async () => {
        // Same shape as above, but the duplicate enqueue arrives at USER
        // priority — should promote the requeued NEIGHBOR A to USER and
        // still dedupe. Net result: ONE task body re-runs (not two).
        const queue = new AnalysisQueue({
          concurrency: 1,
          maxUserBypassSlots: 0,
        });

        let aRuns = 0;
        const aTask = async (signal: AbortSignal): Promise<string> => {
          aRuns += 1;
          const myRun = aRuns;
          if (myRun === 1) {
            return new Promise<string>((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('a-aborted')));
            });
          }
          return `a-final-run-${myRun}`;
        };

        const aPromise = queue.enqueue(aTask, {
          priority: ANALYSIS_PRIORITY_NEIGHBOR,
          key: 'A',
          cancellable: true,
        });

        await flushMicrotasks();
        expect(aRuns).toBe(1);

        // USER click for B preempts A.
        const userGate = deferred<void>();
        const userPromise = queue.enqueue(async () => {
          await userGate.promise;
        }, { priority: ANALYSIS_PRIORITY_USER_SELECTED, key: 'B' });

        for (let i = 0; i < 4; i += 1) {
          await flushMicrotasks();
        }

        // Duplicate enqueue for A but as USER priority — should promote
        // the requeued A to USER and dedupe.
        const aDupAsUser = queue.enqueue(aTask, {
          priority: ANALYSIS_PRIORITY_USER_SELECTED,
          key: 'A',
          cancellable: true,
        });

        // Should NOT spawn a fresh task; aRuns stays at 1 (A is still in
        // pending, hasn't restarted yet).
        expect(aRuns).toBe(1);

        userGate.resolve();
        await userPromise;
        for (let i = 0; i < 8; i += 1) {
          await flushMicrotasks();
        }

        await expect(aPromise).resolves.toBe('a-final-run-2');
        await expect(aDupAsUser).resolves.toBe('a-final-run-2');
        expect(aRuns).toBe(2);
      });
    });
  });
});
