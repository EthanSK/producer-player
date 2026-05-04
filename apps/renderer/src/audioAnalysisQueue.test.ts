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
    const queue = new AnalysisQueue({ concurrency: 1 });
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
});
