// v3.255.0 — pins the behaviour of the two checklist sort helpers
// (Ethan voice 3774 — "I just did sort completed to bottom, and I
// actually put them all at the top. So that's fucked."; then voice
// 33568/f50a/13842 clarified the useful state is outstanding work at the
// bottom, with the active todos sorted by song time).
//
// Storage convention (recap): items[0] is NEWEST. Rendered chronological
// order is `[...items].reverse()` (oldest at index 0 → newest at the end,
// i.e. visually top → bottom).

import { describe, expect, it } from 'vitest';
import type { SongChecklistItem } from '@producer-player/contracts';
import {
  sortChecklistMoveOutstandingToBottom,
  sortChecklistOutstandingByTimestamp,
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

describe('sortChecklistMoveOutstandingToBottom', () => {
  it('returns the same reference for empty / single-item lists (no-op)', () => {
    const empty: SongChecklistItem[] = [];
    expect(sortChecklistMoveOutstandingToBottom(empty)).toBe(empty);
    const one = [makeItem('a')];
    expect(sortChecklistMoveOutstandingToBottom(one)).toBe(one);
  });

  it('moves outstanding todos to the BOTTOM and leaves Won\'t Fix rows above them', () => {
    // Rendered top → bottom: [W1, O2, W3, O4]
    const storage = rendered(
      makeItem('w1', { wontFix: true }),
      makeItem('o2'),
      makeItem('w3', { wontFix: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveOutstandingToBottom(storage);
    const renderedOut = renderedOf(out);
    expect(renderedOut.map((it) => it.id)).toEqual(['w1', 'w3', 'o2', 'o4']);
  });

  it('moves outstanding todos below blue-tick completed items', () => {
    const storage = rendered(
      makeItem('c1', { completed: true }),
      makeItem('o2'),
      makeItem('c3', { completed: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveOutstandingToBottom(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['c1', 'c3', 'o2', 'o4']);
  });

  it('treats both completed and Won\'t Fix as resolved context above outstanding work', () => {
    const storage = rendered(
      makeItem('c1', { completed: true }),
      makeItem('o2'),
      makeItem('w3', { wontFix: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveOutstandingToBottom(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['c1', 'w3', 'o2', 'o4']);
  });

  it('keeps notes above outstanding todos because notes are context, not unfinished work', () => {
    const storage = rendered(
      makeItem('w1', { wontFix: true }),
      makeItem('n2', { isNote: true }),
      makeItem('c3', { completed: true }),
      makeItem('o4'),
    );
    const out = sortChecklistMoveOutstandingToBottom(storage);
    // w1 + n2 + c3 are resolved/context rows; o4 is the only active todo and
    // therefore moves to the working edge at the bottom.
    expect(renderedOf(out).map((it) => it.id)).toEqual(['w1', 'n2', 'c3', 'o4']);
  });

  it('is idempotent — second call on a sorted list returns the same reference', () => {
    const storage = rendered(
      makeItem('c3', { completed: true }),
      makeItem('w4', { wontFix: true }),
      makeItem('o1'),
      makeItem('o2'),
    );
    const first = sortChecklistMoveOutstandingToBottom(storage);
    // Already partitioned (resolved/context rows first, outstanding last) —
    // should be a no-op.
    expect(first).toBe(storage);
    const second = sortChecklistMoveOutstandingToBottom(first as SongChecklistItem[]);
    expect(second).toBe(storage);
  });

  it('returns the same reference when there are no outstanding todos', () => {
    const storage = rendered(
      makeItem('c1', { completed: true }),
      makeItem('w2', { wontFix: true }),
    );
    expect(sortChecklistMoveOutstandingToBottom(storage)).toBe(storage);
  });

  it('returns the same reference when every todo is outstanding already', () => {
    const storage = rendered(makeItem('o1'), makeItem('o2'));
    expect(sortChecklistMoveOutstandingToBottom(storage)).toBe(storage);
  });
});

describe('sortChecklistOutstandingByTimestamp', () => {
  it('returns the same reference for empty / single-item lists', () => {
    const empty: SongChecklistItem[] = [];
    expect(sortChecklistOutstandingByTimestamp(empty)).toBe(empty);
    const one = [makeItem('a', { timestampSeconds: 100 })];
    expect(sortChecklistOutstandingByTimestamp(one)).toBe(one);
  });

  it('sorts only outstanding todos by song timestamp (latest at the bottom)', () => {
    const storage = rendered(
      makeItem('done', { completed: true, completedAt: 3000 }),
      makeItem('late', { timestampSeconds: 180 }),
      makeItem('early', { timestampSeconds: 20 }),
      makeItem('middle', { timestampSeconds: 90 }),
    );
    const out = sortChecklistOutstandingByTimestamp(storage);
    // Regression guard for Ethan voice 33568/f50a/13842: the UI renders top
    // -> bottom, and the bottom is the working/newest edge. Sorting ascending
    // by playback timestamp puts the latest outstanding point last.
    expect(renderedOf(out).map((it) => it.id)).toEqual([
      'done',
      'early',
      'middle',
      'late',
    ]);
  });

  it('does not reorder completed or Won\'t Fix rows while sorting outstanding todos', () => {
    const storage = rendered(
      makeItem('w1', { wontFix: true, completedAt: 5000 }),
      makeItem('late', { timestampSeconds: 120 }),
      makeItem('c2', { completed: true, completedAt: 2000 }),
      makeItem('early', { timestampSeconds: 10 }),
    );
    const out = sortChecklistOutstandingByTimestamp(storage);
    // w1 and c2 keep their top/context relative order; only the active todos
    // are sorted into playback order below them.
    expect(renderedOf(out).map((it) => it.id)).toEqual([
      'w1',
      'c2',
      'early',
      'late',
    ]);
  });

  it('puts outstanding todos without a song timestamp below timestamped outstanding todos', () => {
    const storage = rendered(
      makeItem('untimed1'),
      makeItem('late', { timestampSeconds: 200 }),
      makeItem('untimed2'),
      makeItem('early', { timestampSeconds: 40 }),
      makeItem('done', { completed: true }),
    );
    const out = sortChecklistOutstandingByTimestamp(storage);
    // done/context on top, then timestamped outstanding todos in song order,
    // then untimed active todos in their existing chronological relative order.
    expect(renderedOf(out).map((it) => it.id)).toEqual([
      'done',
      'early',
      'late',
      'untimed1',
      'untimed2',
    ]);
  });

  it('keeps notes above outstanding todos — notes are never reordered into the active work group', () => {
    const storage = rendered(
      makeItem('n1', { isNote: true }),
      makeItem('late', { timestampSeconds: 1000 }),
      makeItem('early', { timestampSeconds: 10 }),
    );
    const out = sortChecklistOutstandingByTimestamp(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['n1', 'early', 'late']);
  });

  it('is idempotent on an already-sorted list (returns the same reference)', () => {
    const storage = rendered(
      makeItem('done', { completed: true }),
      makeItem('early', { timestampSeconds: 20 }),
      makeItem('late', { timestampSeconds: 200 }),
    );
    expect(sortChecklistOutstandingByTimestamp(storage)).toBe(storage);
  });

  it('is stable: outstanding items with the same timestamp keep their existing relative order', () => {
    const storage = rendered(
      makeItem('c', { timestampSeconds: 500 }),
      makeItem('a', { timestampSeconds: 1000 }),
      makeItem('b', { timestampSeconds: 1000 }),
    );
    const out = sortChecklistOutstandingByTimestamp(storage);
    expect(renderedOf(out).map((it) => it.id)).toEqual(['c', 'a', 'b']);
  });
});
