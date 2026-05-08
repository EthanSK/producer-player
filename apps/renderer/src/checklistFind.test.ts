import { describe, expect, it } from 'vitest';
import {
  buildChecklistFindMatches,
  coerceChecklistFindActiveIndex,
  formatChecklistFindStatus,
  getNextChecklistFindIndex,
} from './checklistFind';

const items = [
  { id: 'intro', text: 'Fix vocal sibilance in the intro' },
  { id: 'chorus', text: 'Bass feels huge in CHORUS two' },
  { id: 'outro', text: 'Automate the reverb tail' },
];

describe('checklist find helpers', () => {
  it('finds checklist item text by word or part-word case-insensitively', () => {
    expect(buildChecklistFindMatches(items, 'chor')).toEqual([
      { id: 'chorus', itemIndex: 1 },
    ]);
    expect(buildChecklistFindMatches(items, '  VOCAL  ')).toEqual([
      { id: 'intro', itemIndex: 0 },
    ]);
    expect(buildChecklistFindMatches(items, 'the')).toEqual([
      { id: 'intro', itemIndex: 0 },
      { id: 'outro', itemIndex: 2 },
    ]);
  });

  it('does not match empty or whitespace-only queries', () => {
    expect(buildChecklistFindMatches(items, '')).toEqual([]);
    expect(buildChecklistFindMatches(items, '   ')).toEqual([]);
  });

  it('keeps the active index inside the available result range', () => {
    expect(coerceChecklistFindActiveIndex(-1, 3)).toBe(0);
    expect(coerceChecklistFindActiveIndex(1, 3)).toBe(1);
    expect(coerceChecklistFindActiveIndex(99, 3)).toBe(2);
    expect(coerceChecklistFindActiveIndex(0, 0)).toBe(-1);
  });

  it('cycles next on Enter and previous on Shift+Enter semantics', () => {
    expect(getNextChecklistFindIndex(-1, 3, 'next')).toBe(0);
    expect(getNextChecklistFindIndex(0, 3, 'next')).toBe(1);
    expect(getNextChecklistFindIndex(2, 3, 'next')).toBe(0);

    expect(getNextChecklistFindIndex(-1, 3, 'previous')).toBe(2);
    expect(getNextChecklistFindIndex(0, 3, 'previous')).toBe(2);
    expect(getNextChecklistFindIndex(2, 3, 'previous')).toBe(1);
  });

  it('formats useful empty, no-result, and positioned statuses', () => {
    expect(formatChecklistFindStatus('', -1, 0)).toBe('Type to find checklist items');
    expect(formatChecklistFindStatus('snare', -1, 0)).toBe('No results for “snare”');
    expect(formatChecklistFindStatus('bass', 1, 4)).toBe('2 / 4');
  });
});
