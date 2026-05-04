import { describe, expect, it, vi } from 'vitest';
import {
  AnalysisQueue,
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

    await Promise.all([p1, p2]);

    expect(taskFn).toHaveBeenCalledTimes(1);
    await expect(p1).resolves.toBe('result');
    await expect(p2).resolves.toBe('result');
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
    expect(snap.pendingByPriority).toEqual({ user: 2, neighbor: 1, background: 1 });
    expect(snap.userBypassActive).toBe(0);

    blocker.resolve();
    while (queue.stats().active > 0 || queue.stats().pending > 0) {
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks();
    }
  });
});
