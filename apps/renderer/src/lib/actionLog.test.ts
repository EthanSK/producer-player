/**
 * v3.200 — Renderer-side action log tests.
 *
 * The renderer module ships a tiny serialization layer plus a thin IPC
 * bridge. We test the serialization (`toErrorPayload`, `safeStringify`,
 * `truncate`) and end-to-end behavior via a stubbed `producerPlayer`
 * bridge so the IPC contract is locked down without spinning up
 * Electron.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionLogEntry } from '@producer-player/contracts';

import { __testing__, logAction, logError } from './actionLog';

const { toErrorPayload, safeStringify, truncate } = __testing__;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns input unchanged when within bounds', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });
  it('adds an explicit ellipsis with overflow count', () => {
    expect(truncate('abcdefghij', 4)).toBe('abcd…[truncated 6ch]');
  });
});

describe('safeStringify', () => {
  it('handles circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(safeStringify(obj)).toMatch(/\[Circular\]/);
  });
});

describe('toErrorPayload', () => {
  it('unwraps Error instances', () => {
    const err = new TypeError('bad');
    const out = toErrorPayload(err);
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('bad');
    expect(out.stack).toMatch(/TypeError/);
  });
  it('handles plain objects', () => {
    expect(toErrorPayload({ name: 'X', message: 'y' })).toEqual({
      name: 'X',
      message: 'y',
      stack: undefined,
    });
  });
  it('handles primitives', () => {
    expect(toErrorPayload('boom').message).toBe('boom');
    expect(toErrorPayload(null).message).toBe('unknown');
    expect(toErrorPayload(undefined).message).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Bridge integration
// ---------------------------------------------------------------------------

describe('logAction / logError bridge wiring', () => {
  let appendCalls: ActionLogEntry[] = [];
  // Stub a minimal `window` in the Node environment so getBridge() returns
  // our test double. The renderer module checks `typeof window !== 'undefined'`
  // before reading `window.producerPlayer`.
  const globalWithWindow = globalThis as unknown as { window?: object };

  beforeEach(() => {
    appendCalls = [];
    globalWithWindow.window = {
      producerPlayer: {
        appendActionLog: vi.fn((entry: ActionLogEntry) => {
          appendCalls.push(entry);
          return Promise.resolve();
        }),
      },
    };
  });

  afterEach(() => {
    delete globalWithWindow.window;
  });

  it('logAction posts a renderer-source entry with default info level', () => {
    logAction('song.play', { songId: 's1' });
    expect(appendCalls).toHaveLength(1);
    const entry = appendCalls[0];
    expect(entry.event).toBe('song.play');
    expect(entry.level).toBe('info');
    expect(entry.source).toBe('renderer');
    expect(entry.context).toEqual({ songId: 's1' });
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('logAction omits the context field when empty/undefined', () => {
    logAction('app.start');
    expect(appendCalls[0].context).toBeUndefined();
  });

  it('logAction respects a custom level', () => {
    logAction('thing.warn', undefined, 'warn');
    expect(appendCalls[0].level).toBe('warn');
  });

  it('logError attaches a normalized error payload at level=error', () => {
    logError('error.test', new RangeError('overflow'), { route: '/x' });
    expect(appendCalls).toHaveLength(1);
    const entry = appendCalls[0];
    expect(entry.level).toBe('error');
    expect(entry.error?.name).toBe('RangeError');
    expect(entry.error?.message).toBe('overflow');
    expect(entry.context).toEqual({ route: '/x' });
  });

  it('logAction is a silent no-op when the bridge is missing', () => {
    delete globalWithWindow.window;
    expect(() => logAction('orphan')).not.toThrow();
  });

  it('logAction is a silent no-op when producerPlayer is missing the method', () => {
    globalWithWindow.window = { producerPlayer: {} };
    expect(() => logAction('orphan')).not.toThrow();
  });

  it('logAction swallows bridge rejections silently', async () => {
    globalWithWindow.window = {
      producerPlayer: {
        appendActionLog: vi.fn(() => Promise.reject(new Error('ipc broke'))),
      },
    };
    expect(() => logAction('orphan')).not.toThrow();
    // give microtasks a chance to fire so any unhandled-rejection would surface
    await Promise.resolve();
  });
});
