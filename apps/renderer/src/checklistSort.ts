// v3.249.0 — pure checklist sort helpers (Ethan voice 3774).
//
// Extracted out of App.tsx so the two sort variants are unit-testable in
// isolation. Both operate on the STORAGE order (newest-first array) and
// return a NEW storage-order array; the caller is responsible for passing
// the result back to `updateSongChecklistItems`. Callers should still
// short-circuit when the result is `===` the input — the helpers return
// the same reference when there's nothing to do.
//
// Terminology:
//   - "storage order" = items[0] is NEWEST. New items are prepended.
//   - "chronological order" = oldest at index 0, newest at the end (i.e.
//     the rendered order on screen, top → bottom).
//
// `isDone` rule (shared across both sorts):
//   - notes (isNote === true) are NEVER considered done.
//   - any item with `completed === true` is done.
//   - any item with `wontFix === true` is done (v3.244+ Won't Fix state).

import type { SongChecklistItem } from '@producer-player/contracts';

function isItemDone(item: SongChecklistItem): boolean {
  if (item.isNote === true) return false;
  return item.completed === true || item.wontFix === true;
}

function arraysIdentical<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Sort: stable partition that moves all DONE items (completed === true OR
 * wontFix === true) to the BOTTOM of the chronological list, while OPEN
 * items (and notes) stay at the top. Within each group the existing
 * relative order is preserved.
 *
 * v3.245 introduced this sort; v3.249 re-homed it to a pure function so
 * we could ship a unit test after Ethan voice 3774 reported the result
 * appeared inverted ("I just did sort completed to bottom, and I
 * actually put them all at the top"). The test suite in
 * `checklistSort.test.ts` exercises the storage→render round-trip across
 * mixed Won't Fix / completed / open / note inputs and pins the
 * expected visual layout, so any future regression will be caught.
 */
export function sortChecklistMoveCompletedToBottom(
  storedItems: readonly SongChecklistItem[],
): SongChecklistItem[] | readonly SongChecklistItem[] {
  if (storedItems.length < 2) return storedItems;
  const chronological = [...storedItems].reverse();
  const top: SongChecklistItem[] = [];
  const bottom: SongChecklistItem[] = [];
  for (const item of chronological) {
    if (isItemDone(item)) bottom.push(item);
    else top.push(item);
  }
  if (top.length === 0 || bottom.length === 0) return storedItems;
  const sortedChronological = [...top, ...bottom];
  if (arraysIdentical(sortedChronological, chronological)) return storedItems;
  return [...sortedChronological].reverse();
}

/**
 * v3.249.0 — Sort: order the COMPLETED items by their completion
 * timestamp (oldest first → newest last). Open todos and notes are
 * untouched and stay at the top of the list in their existing order.
 * Items without a completedAt (any pre-v3.249 ticks) sink to the bottom
 * of the completed group in their existing relative order — we don't
 * invent a fake timestamp for them.
 *
 * Caller contract identical to `sortChecklistMoveCompletedToBottom`:
 * pass STORAGE order in, get STORAGE order back (or the same reference
 * if it's a no-op).
 */
export function sortChecklistCompletedByTime(
  storedItems: readonly SongChecklistItem[],
): SongChecklistItem[] | readonly SongChecklistItem[] {
  if (storedItems.length < 2) return storedItems;
  const chronological = [...storedItems].reverse();
  const opens: SongChecklistItem[] = [];
  const doneWithTime: SongChecklistItem[] = [];
  const doneWithoutTime: SongChecklistItem[] = [];
  for (const item of chronological) {
    if (!isItemDone(item)) {
      opens.push(item);
    } else if (typeof item.completedAt === 'number') {
      doneWithTime.push(item);
    } else {
      doneWithoutTime.push(item);
    }
  }
  // Array.prototype.sort is guaranteed stable since ES2019 — items with
  // identical timestamps therefore retain their incoming relative order.
  doneWithTime.sort(
    (a, b) => (a.completedAt as number) - (b.completedAt as number),
  );
  const sortedChronological = [...opens, ...doneWithTime, ...doneWithoutTime];
  if (arraysIdentical(sortedChronological, chronological)) return storedItems;
  return [...sortedChronological].reverse();
}
