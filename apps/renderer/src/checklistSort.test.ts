// v3.249.0 — pins the behaviour of the two checklist sort helpers
// (Ethan voice 3774 — "I just did sort completed to bottom, and I
// actually put them all at the top. So that's fucked.").
//
// Storage convention (recap): items[0] is NEWEST. Rendered chronological
// order is `[...items].reverse()` (oldest at index 0 → newest at the end,
// i.e. visually top → bottom).

import { describe, expect, it } from 'vitest';
import type { SongChecklistItem } from '@producer-player/contracts';
import {
  sortChecklistMoveCompletedToBottom,
  sortChecklistCompletedByTime,
} from './checklistSort';

function makeItem(
  id: string,
  overrides: Partial<SongChecklistItem> = {},
): SongChecklistItem {
  return {
    id,
    text: id,
    completed: false,
    timestampSeconds: null,
    versionNumber: null,
    listeningDeviceId: null,
    ...overrides,
  };
}

// Convert a "rendered top → bottom" list (the user's mental model) into
// storage order. The helpers operate on storage; tests author lists in
// rendered order so they read like the UI.
function rendered(...items: SongChecklistItem[]): SongChecklistItem[] {
  return [...items].reverse();
}

function renderedOf(storage: readonly SongChecklistItem[]): SongChecklistItem[] {
  return [...storage].reverse();
}

describe('sortChecklistMoveCompletedToBottom', () => {
  it('returns the same reference for empty / single-item lists (no-op)', () => {
    const empty: SongChecklistItem[] = [];
    expect(sortChecklistMoveCompletedToBottom(empty)).toBe(empty);
    const one = [makeItem('a')];
    expect(sortChecklistMoveCompletedToBottom(one)).toBe(one);
  });

  it('moves Won\'t Fix items to the BOTTOM (not the top) — pins the v3.245 sort against the Ethan voice 3774 inversion report', () => {
    // Rendered top → bottom: [W1, O2, W3, O4]
    const storage = rendered(
      makeItem('w1', { wontFix: true }),
      makeItem('o2'),
      makeItem('w3', { wontFix: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveCompletedToBottom(storage);
    const renderedOut = renderedOf(out);
    expect(renderedOut.map((it) => it.id)).toEqual(['o2', 'o4', 'w1', 'w3']);
  });

  it('moves blue-tick completed items to the BOTTOM', () => {
    const storage = rendered(
      makeItem('c1', { completed: true }),
      makeItem('o2'),
      makeItem('c3', { completed: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveCompletedToBottom(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['o2', 'o4', 'c1', 'c3']);
  });

  it('treats both completed and Won\'t Fix as done in the same partition', () => {
    const storage = rendered(
      makeItem('c1', { completed: true }),
      makeItem('o2'),
      makeItem('w3', { wontFix: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveCompletedToBottom(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['o2', 'o4', 'c1', 'w3']);
  });

  it('keeps notes at the top alongside open todos (notes never sink)', () => {
    const storage = rendered(
      makeItem('w1', { wontFix: true }),
      makeItem('n2', { isNote: true }),
      makeItem('c3', { completed: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveCompletedToBottom(storage);
    // n2 + o4 are "not done", stay on top; w1 + c3 sink
    expect(renderedOf(out).map((it) => it.id)).toEqual(['n2', 'o4', 'w1', 'c3']);
  });

  it('is idempotent — second call on a sorted list returns the same reference', () => {
    const storage = rendered(
      makeItem('o1'),
      makeItem('o2'),
      makeItem('c3', { completed: true }),
      makeItem('w4', { wontFix: true }),
    );
    const first = sortChecklistMoveCompletedToBottom(storage);
    // Already partitioned (opens first, dones last) — should be a no-op
    expect(first).toBe(storage);
    const second = sortChecklistMoveCompletedToBottom(first as SongChecklistItem[]);
    expect(second).toBe(storage);
  });

  it('returns the same reference when there are no open items (nothing to keep on top)', () => {
    const storage = rendered(
      makeItem('c1', { completed: true }),
      makeItem('w2', { wontFix: true }),
    );
    expect(sortChecklistMoveCompletedToBottom(storage)).toBe(storage);
  });

  it('returns the same reference when there are no done items', () => {
    const storage = rendered(makeItem('o1'), makeItem('o2'));
    expect(sortChecklistMoveCompletedToBottom(storage)).toBe(storage);
  });
});

describe('sortChecklistCompletedByTime', () => {
  it('returns the same reference for empty / single-item lists', () => {
    const empty: SongChecklistItem[] = [];
    expect(sortChecklistCompletedByTime(empty)).toBe(empty);
    const one = [makeItem('a', { completed: true, completedAt: 100 })];
    expect(sortChecklistCompletedByTime(one)).toBe(one);
  });

  it('sorts completed items by completedAt (newest first)', () => {
    const storage = rendered(
      makeItem('o1'),
      makeItem('c2', { completed: true, completedAt: 3000 }),
      makeItem('c3', { completed: true, completedAt: 1000 }),
      makeItem('c4', { completed: true, completedAt: 2000 }),
    );
    const out = sortChecklistCompletedByTime(storage);
    // Regression guard for Ethan voice 3884: the UI renders top -> bottom,
    // so the newest completion timestamp must be FIRST inside the completed
    // group. Ascending order made the newest ticked-off item sink to the
    // bottom, which made "sort completed by time" feel backwards.
    expect(renderedOf(out).map((it) => it.id)).toEqual(['o1', 'c2', 'c4', 'c3']);
  });

  it('sorts Won\'t Fix items by completedAt alongside blue-tick completed items', () => {
    const storage = rendered(
      makeItem('w1', { wontFix: true, completedAt: 5000 }),
      makeItem('c2', { completed: true, completedAt: 2000 }),
      makeItem('w3', { wontFix: true, completedAt: 1000 }),
      makeItem('o4'),
    );
    const out = sortChecklistCompletedByTime(storage);
    // Opens first (o4), then done sorted newest-first by time:
    // w1=5000, c2=2000, w3=1000.
    expect(renderedOf(out).map((it) => it.id)).toEqual(['o4', 'w1', 'c2', 'w3']);
  });

  it('puts done items WITHOUT a completedAt at the very bottom in their existing relative order (legacy ticks)', () => {
    const storage = rendered(
      makeItem('legacy1', { completed: true }),
      makeItem('c2', { completed: true, completedAt: 2000 }),
      makeItem('legacy3', { completed: true }),
      makeItem('c4', { completed: true, completedAt: 1000 }),
      makeItem('o5'),
    );
    const out = sortChecklistCompletedByTime(storage);
    // o5 (open) on top, then timed newest-first: c2=2000, c4=1000,
    // then legacy entries in their existing chronological relative order:
    // legacy1, legacy3
    expect(renderedOf(out).map((it) => it.id)).toEqual([
      'o5',
      'c2',
      'c4',
      'legacy1',
      'legacy3',
    ]);
  });

  it('keeps notes at the top alongside open todos — notes are never reordered into the done group', () => {
    const storage = rendered(
      makeItem('n1', { isNote: true }),
      makeItem('c2', { completed: true, completedAt: 1000 }),
      makeItem('o3'),
    );
    const out = sortChecklistCompletedByTime(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['n1', 'o3', 'c2']);
  });

  it('is idempotent on an already-sorted list (returns the same reference)', () => {
    const storage = rendered(
      makeItem('o1'),
      makeItem('c3', { completed: true, completedAt: 2000 }),
      makeItem('c2', { completed: true, completedAt: 1000 }),
    );
    expect(sortChecklistCompletedByTime(storage)).toBe(storage);
  });

  it('is stable: items with the same completedAt keep their existing relative order', () => {
    const storage = rendered(
      makeItem('c', { completed: true, completedAt: 500 }),
      makeItem('a', { completed: true, completedAt: 1000 }),
      makeItem('b', { completed: true, completedAt: 1000 }),
    );
    const out = sortChecklistCompletedByTime(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['a', 'b', 'c']);
  });
});
