import { describe, expect, it } from 'vitest';
import { runSequentialLatestTrackWarmup } from './latestTrackWarmup';

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
    // eslint-disable-next-line no-await-in-loop -- intentional microtask drain
    await Promise.resolve();
  }
}

describe('runSequentialLatestTrackWarmup', () => {
  it('processes warmup entries sequentially instead of starting a batch', async () => {
    const firstGate = deferred<void>();
    const events: string[] = [];

    const run = runSequentialLatestTrackWarmup({
      entries: ['alpha', 'bravo', 'charlie'],
      isCancelled: () => false,
      hasUrgentWork: () => false,
      wait: async () => undefined,
      processEntry: async (entry) => {
        events.push(`start:${entry}`);
        if (entry === 'alpha') {
          await firstGate.promise;
        }
        events.push(`finish:${entry}`);
      },
    });

    await flushMicrotasks();
    expect(events).toEqual(['start:alpha']);

    firstGate.resolve();
    await run;

    expect(events).toEqual([
      'start:alpha',
      'finish:alpha',
      'start:bravo',
      'finish:bravo',
      'start:charlie',
      'finish:charlie',
    ]);
  });

  it('pauses between tracks while urgent user work jumps the queue, then resumes', async () => {
    const events: string[] = [];
    let urgentChecksRemaining = 0;

    await runSequentialLatestTrackWarmup({
      entries: ['alpha', 'bravo', 'charlie'],
      isCancelled: () => false,
      hasUrgentWork: () => urgentChecksRemaining > 0,
      wait: async (ms) => {
        events.push(`wait:${ms}`);
        if (ms > 0 && urgentChecksRemaining > 0) {
          events.push('urgent-user-work-ran');
          urgentChecksRemaining -= 1;
        }
      },
      onUrgentPause: () => {
        events.push('paused-for-urgent');
      },
      processEntry: async (entry) => {
        events.push(`process:${entry}`);
        if (entry === 'alpha') {
          urgentChecksRemaining = 2;
        }
      },
      urgentPollMs: 25,
    });

    expect(events).toEqual([
      'wait:0',
      'process:alpha',
      'wait:0',
      'paused-for-urgent',
      'wait:25',
      'urgent-user-work-ran',
      'wait:25',
      'urgent-user-work-ran',
      'process:bravo',
      'wait:0',
      'process:charlie',
    ]);
  });

  it('stops before starting the next track when cancelled during the cooperative pause', async () => {
    const events: string[] = [];
    let cancelled = false;

    await runSequentialLatestTrackWarmup({
      entries: ['alpha'],
      isCancelled: () => cancelled,
      hasUrgentWork: () => true,
      wait: async (ms) => {
        events.push(`wait:${ms}`);
        if (ms > 0) {
          cancelled = true;
        }
      },
      processEntry: async (entry) => {
        events.push(`process:${entry}`);
      },
      urgentPollMs: 25,
    });

    expect(events).toEqual(['wait:0', 'wait:25']);
  });
});
