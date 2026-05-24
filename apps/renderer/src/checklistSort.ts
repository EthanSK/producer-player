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
// `isDone` / `isOutstanding` rules (shared across both sorts):
//   - notes (isNote === true) are NEVER considered done.
//   - any item with `completed === true` is done.
//   - any item with `wontFix === true` is done (v3.244+ Won't Fix state).
//   - outstanding means an actionable open todo: not a note, not completed,
//     not Won't Fix.

import type { SongChecklistItem } from '@producer-player/contracts';

function isItemDone(item: SongChecklistItem): boolean {
  if (item.isNote === true) return false;
  return item.completed === true || item.wontFix === true;
}

export function isChecklistOutstanding(item: SongChecklistItem): boolean {
  // Notes are context, not unfinished work. Keeping that distinction here
  // prevents the "outstanding to bottom" actions from dragging permanent notes
  // into the active todo group Ethan is trying to work through.
  return item.isNote !== true && !isItemDone(item);
}

function arraysIdentical<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Sort: stable partition that moves actionable OUTSTANDING todos to the
 * BOTTOM of the chronological list, while completed / Won't Fix rows and
 * permanent notes stay above them. Within each group the existing relative
 * order is preserved.
 *
 * v3.245 introduced this sort; v3.249 re-homed it to a pure function so
 * we could ship a unit test after Ethan voice 3774 reported the result
 * appeared inverted ("I just did sort completed to bottom, and I
 * actually put them all at the top"). The test suite in
 * `checklistSort.test.ts` exercises the storage→render round-trip across
 * mixed Won't Fix / completed / open / note inputs and pins the
 * expected visual layout, so any future regression will be caught.
 *
 * v3.255 correction: Ethan clarified the actual workflow is "active work at
 * the bottom" because the composer/newest-item area is at the bottom of the
 * modal. This function intentionally supersedes the old completed-to-bottom
 * behavior; the bug was treating finished work as the bottom group and pushing
 * the rows he still needs to address away from the working edge.
 */
export function sortChecklistMoveOutstandingToBottom(
  storedItems: readonly SongChecklistItem[],
): SongChecklistItem[] | readonly SongChecklistItem[] {
  if (storedItems.length < 2) return storedItems;
  const chronological = [...storedItems].reverse();
  const top: SongChecklistItem[] = [];
  const bottom: SongChecklistItem[] = [];
  for (const item of chronological) {
    if (isChecklistOutstanding(item)) bottom.push(item);
    else top.push(item);
  }
  if (top.length === 0 || bottom.length === 0) return storedItems;
  const sortedChronological = [...top, ...bottom];
  if (arraysIdentical(sortedChronological, chronological)) return storedItems;
  return [...sortedChronological].reverse();
}

/**
 * v3.255.0 — Sort: order only the OUTSTANDING todos by their song timestamp.
 * Completed / Won't Fix rows and notes stay above the active work group in
 * their existing order. Timestamped outstanding todos sort oldest → newest so
 * the latest point in the song lands at the bottom, matching the modal's
 * bottom-is-newest mental model. Untimed outstanding todos stay after the
 * timestamped ones in their existing relative order because there is no safe
 * timeline position to invent for them.
 *
 * Caller contract identical to `sortChecklistMoveOutstandingToBottom`:
 * pass STORAGE order in, get STORAGE order back (or the same reference
 * if it's a no-op).
 */
export function sortChecklistOutstandingByTimestamp(
  storedItems: readonly SongChecklistItem[],
): SongChecklistItem[] | readonly SongChecklistItem[] {
  if (storedItems.length < 2) return storedItems;
  const chronological = [...storedItems].reverse();
  const top: SongChecklistItem[] = [];
  const outstandingWithTime: SongChecklistItem[] = [];
  const outstandingWithoutTime: SongChecklistItem[] = [];
  for (const item of chronological) {
    if (!isChecklistOutstanding(item)) {
      top.push(item);
    } else if (
      typeof item.timestampSeconds === 'number' &&
      Number.isFinite(item.timestampSeconds)
    ) {
      outstandingWithTime.push(item);
    } else {
      outstandingWithoutTime.push(item);
    }
  }
  // Regression guard for voice 33568/f50a/13842: the rendered list is top →
  // bottom, and Ethan wants the newest/latest outstanding point at the bottom.
  // Sorting ascending by the checklist item's song timestamp gives an audible
  // walkthrough order: earliest issue first, latest issue closest to the
  // composer/working edge.
  //
  // Array.prototype.sort is guaranteed stable since ES2019 — items with
  // identical timestamps therefore retain their incoming relative order.
  outstandingWithTime.sort(
    (a, b) => (a.timestampSeconds as number) - (b.timestampSeconds as number),
  );
  const sortedChronological = [
    ...top,
    ...outstandingWithTime,
    ...outstandingWithoutTime,
  ];
  if (arraysIdentical(sortedChronological, chronological)) return storedItems;
  return [...sortedChronological].reverse();
}
